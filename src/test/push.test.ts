require('./env').install()

import crypto from 'crypto'
import test from 'tape'
import nock from 'nock'
import sinon from 'sinon'
import pick from 'lodash/pick'
import buildResource from '@tradle/build-resource'
import { utils as tradleUtils } from '@tradle/engine'
import Push, { getChallenge, getNotificationData } from '../push'
import Logger from '../logger'
import { loudAsync, omitVirtual } from '../utils'
import { getSigningKey, sha256 } from '../crypto'
import { createBot } from '../'

const alice = omitVirtual(require('./fixtures/alice/identity'))
const aliceKeys = require('./fixtures/alice/keys').map(k => tradleUtils.importKey(k))

test('push', loudAsync(async (t) => {
  const serverUrl = 'http://localhost:12345'
  const key = getSigningKey(aliceKeys)
  const nonce = crypto.randomBytes(10).toString('hex')

  let preregistered
  let registered
  let pushed
  nock(serverUrl)
    .post('/publisher')
    .reply((uri, body) => {
      preregistered = true
      t.same(body, {
        identity: alice,
        key: key.toJSON(false)
      })

      return nonce
    })

  nock(serverUrl)
    .post('/publisher')
    .reply((uri, body) => {
      registered = true
      t.ok(body.nonce && body.salt && body.sig)
      t.equal(body.nonce, nonce)
      const challenge = getChallenge({ nonce, salt: body.salt })
      t.ok(key.verifySync(challenge, body.sig))
    })

  const namespace = 'test' + Date.now()
  const bot = createBot()
  const push = new Push({
    serverUrl,
    conf: bot.kv.sub(namespace),
    logger: bot.env.sublogger('push:')
  })

  t.equal(await push.isRegistered(), false)

  await push.register({
    identity: alice,
    key
  })

  t.equal(preregistered, true)
  t.equal(registered, true)
  t.equal(await push.isRegistered(), true)

  const subscriber = 'bob'
  const getNotificationRequest = (uri, body) => {
    pushed = true
    t.equal(body.publisher, buildResource.permalink(alice))
    t.equal(body.subscriber, subscriber)
    const data = getNotificationData(body)
    t.ok(key.verifySync(data, body.sig))
  }

  nock(serverUrl)
    .post('/notification')
    .reply(getNotificationRequest)

  t.same(await push.getSubscriber(subscriber), { seq: 0 })

  await push.push({
    identity: alice,
    key,
    subscriber
  })

  t.equal(pushed, true)
  t.equal((await push.getSubscriber(subscriber)).seq, 1)

  nock(serverUrl)
    .post('/notification')
    .reply(getNotificationRequest)

  await push.push({
    identity: alice,
    key,
    subscriber
  })

  t.equal((await push.getSubscriber(subscriber)).seq, 2)

  nock(serverUrl)
    .post('/notification')
    .reply((uri, body) => {
      return [
        400,
        'subscriber not found'
      ]
    })

  try {
    await push.push({
      identity: alice,
      key,
      subscriber
    })

    t.fail('expected failure')
  } catch (err) {
    t.ok(err)
  }

  t.same(pick(await push.getSubscriber(subscriber), ['seq', 'errorCount']), { seq: 3, errorCount: 1 })

  t.end()
}))
