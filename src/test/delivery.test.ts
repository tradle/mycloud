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

  const interval = 200
  sandbox.stub(delivery, '_post').callsFake(async () => {
    await wait(interval)
    throw new Error('test delivery failure')
  })

  const remainingTime = 1000
  sandbox.stub(bot.env, 'getRemainingTimeWithBuffer').callsFake(() => {
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
    didRetry(opts)
  })

  const start = new Date('2000-01-01').getTime()
  await delivery.deliverBatch({
    friend,
    recipient: bob.permalink,
    messages: payloads.map((payload, i) => {
      return {
        [TYPE]: 'tradle.Message',
        object: payload,
        _time: start + i * 1000,
        _counterparty: bob.permalink,
      }
    })
  })

  const deliveryErrs = await delivery.getErrors()
  t.equal(deliveryErrs.length, 1)

  bot.fire(bot.events.topics.delivery.error.async, deliveryErrs[0])

  const retryParams = await promiseRetry
  t.same(retryParams, {
    recipient: bob.permalink,
    range: { after: start - 1 }
  })

  // t.equal((await delivery.getErrors()).length, 0)

  sandbox.restore()
  t.end()
}))

const clearErrors = async delivery => Promise.map(await delivery.getErrors(), delivery.deleteError)
