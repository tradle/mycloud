require('./env').install()

import crypto = require('crypto')
import test = require('tape')
import nock = require('nock')
import sinon = require('sinon')
import buildResource = require('@tradle/build-resource')
import Push, { getChallenge, getNotificationData } from '../push'
import Logger from '../logger'
import { loudAsync } from './utils'
import { getSigningKey, sha256 } from '../crypto'
import alice = require('./fixtures/alice/identity')
import aliceKeys = require('./fixtures/alice/keys')
import { tradle } from '../'

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
        key: key.toJSON()
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
  const push = new Push({
    serverUrl,
    conf: tradle.conf.sub(namespace),
    logger: new Logger()
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

  t.same(await push.getSubscriber(subscriber), { seq: -1 })

  await push.push({
    identity: alice,
    key,
    subscriber
  })

  t.equal(pushed, true)
  t.same(await push.getSubscriber(subscriber), { seq: 0 })

  nock(serverUrl)
    .post('/notification')
    .reply(getNotificationRequest)

  await push.push({
    identity: alice,
    key,
    subscriber
  })

  t.same(await push.getSubscriber(subscriber), { seq: 1 })

  t.end()
}))
