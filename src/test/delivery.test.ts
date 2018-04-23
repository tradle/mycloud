require('./env').install()

// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import sinon from 'sinon'
import test from 'tape'
import { TYPE } from '@tradle/constants'
import { Delivery } from '../delivery-http'
import { createTestBot } from '../'
import { loudAsync, wait } from '../utils'
import Errors from '../errors'
import { TYPES } from '../constants'

const { DELIVERY_ERROR } = TYPES
const alice = require('./fixtures/alice/object')
const bob = require('./fixtures/bob/object')

test('retry', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const bot = createTestBot()
  const delivery = bot.delivery.http

  // cleanup
  await clearErrors(delivery)
  // t.same(await delivery.getErrors(), [])

  // await delivery.saveError({
  //   counterparty: 'a',
  //   time: 1
  // })

  // t.equal((await delivery.getErrors()).length, 1)

  // try {
  //   await delivery.saveError({
  //     counterparty: 'a',
  //     time: 2
  //   })
  // } catch (err) {
  //   t.ok(Errors.matches(err, Errors.Exists))
  // }

  // t.equal((await delivery.getErrors()).length, 1)
  // await clearErrors(delivery)

  const payloads = _.range(10).map(i => {
    return {
      to: bob.permalink,
      object: bot
        .draft({ type: 'tradle.SimpleMessage' })
        .set({ message: '' + i })
        .toJSON()
    }
  })

  let interval = 200
  let fail = true
  sandbox.stub(delivery, '_post').callsFake(async () => {
    if (fail) {
      await wait(interval)
      throw new Error('test delivery failure')
    }
  })

  const recipientPubKey = bob.object.pubkeys.find(p => p.type === 'ec' && p.purpose === 'sign')
  recipientPubKey.pub = new Buffer(recipientPubKey.pub, 'hex')

  let remainingTime = 1000
  sandbox.stub(bot.env, 'getRemainingTime').callsFake(() => {
    return remainingTime
  })

  const friend = {
    url: 'friend.somewhere'
  }

  sandbox.stub(bot.friends, 'getByIdentityPermalink').resolves(friend)

  let didRetry
  const promiseRetry = new Promise(resolve => didRetry = resolve)

  sandbox.stub(bot.delivery, 'deliverMessages').callsFake(async (opts) => {
    await wait(100)
    await opts.onProgress()
    didRetry(opts)
  })

  await delivery.deliverBatch({
    friend,
    recipient: bob.permalink,
    messages: payloads.map((payload, i) => {
      return {
        [TYPE]: 'tradle.Message',
        recipientPubKey,
        object: payload,
        time: i,
        _counterparty: bob.permalink,
      }
    })
  })

  t.equal((await delivery.getErrors()).length, 1)

  const retryParams = await promiseRetry
  t.same(_.omit(retryParams, 'onProgress'), {
    friend,
    recipient: bob.permalink,
    range: { after: -1 }
  })

  t.equal((await delivery.getErrors()).length, 0)

  sandbox.restore()
  t.end()
}))

const clearErrors = async delivery => Promise.map(await delivery.getErrors(), delivery.deleteError)
