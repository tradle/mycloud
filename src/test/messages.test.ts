require('./env').install()

// const awsMock = require('aws-sdk-mock')
import _ from 'lodash'
import AWS from 'aws-sdk'
AWS.config.paramValidation = false

import yn from 'yn'
import test from 'tape'
import pify from 'pify'
import ecdsa from 'nkey-ecdsa'
import sinon from 'sinon'
import tradle from '@tradle/engine'
import {
  extractSigPubKey,
  exportKeys,
  getSigningKey,
  sign,
  getLink,
  withLinks,
  getLinks
} from '../crypto'

import { loudAsync, co, typeforce, pickVirtual, omitVirtual } from '../utils'
import Errors from '../errors'
import {
  SIG,
  SEQ,
  PREV_TO_RECIPIENT,
  TYPE,
  TYPES,
  AUTHOR,
  ORG,
  TIMESTAMP,
} from '../constants'

import { createTestBot } from '../'
import * as types from '../typeforce-types'

const { newIdentity } = tradle.utils
const { MESSAGE } = TYPES
const { identities, messages, objects, messaging } = createTestBot()
const { _doQueueMessage, _doReceiveMessage } = messaging
const fromBobToAlice = require('./fixtures/alice/receive.json')
const fromAliceToBob = require('./fixtures/bob/receive.json')
const promiseNoop = () => Promise.resolve()

const [alice, bob] = ['alice', 'bob'].map(name => {
  const identity = require(`./fixtures/${name}/identity`)
  return {
    identity: withLinks(identity),
    // object: identity,
    // link: getLink(identity),
    // permalink: getLink(identity),
    keys: require(`./fixtures/${name}/keys`)
  }
})

test('extract pub key', function (t) {
  const { identity } = alice
  const { curve, pub } = extractSigPubKey(identity)
  const expected = identity.pubkeys.find(key => {
    return key.purpose === 'update'
  })

  t.equal(curve, expected.curve)
  t.equal(pub, expected.pub)

  identity.blah = 'blah'
  try {
    extractSigPubKey(identity)
    t.fail('validated invalid signature')
  } catch (err) {
    t.ok(err instanceof Errors.InvalidSignature)
  }

  t.end()
})

// test.only('identities', loudAsync(async (t) => {
//   const { identity } = alice
//   const { pubkeys } = identity
//   // const sandbox = sinon.createSandbox()
//   const { link, permalink } = getLinks(identity)

//   await identities.delContactWithHistory(identity)
//   await identities.addContactWithoutValidating(identity)
//   // should fail
//   await identities.putPubKey({
//     ...pubkeys[0],
//     link,
//     permalink,
//     _time: identity._time - 1
//   })

//   t.end()
// }))

test('_doQueueMessage', loudAsync(async (t) => {
  // t.plan(3)

  const sandbox = sinon.createSandbox()
  const payload = {
    [TYPE]: 'tradle.SimpleMessage',
    [ORG]: alice.identity._permalink,
    message: 'hey bob',
    // embed: 'data:image/jpeg;base64,somebase64'
  }

  sandbox.stub(identities, 'byPermalink').callsFake(mocks.byPermalink)

  let nextSeq = 0
  const prevMsgLink = 'abc'
  const stubLastSeqAndLink = sandbox.stub(messages, 'getLastSeqAndLink')
    .callsFake(() => Promise.resolve({
      seq: nextSeq - 1,
      link: prevMsgLink
    }))

  const stubPutObject = sandbox.stub(objects, 'put').callsFake(function (object) {
    t.ok(object[SIG])
    payload[SIG] = object[SIG]
    t.same(_.omit(omitVirtual(object), [AUTHOR, TIMESTAMP]), payload)
    return Promise.resolve()
  })

  // const stubReplaceEmbeds = sandbox.stub(objects, 'replaceEmbeds', promiseNoop)

  // Events.putEvent = function (event) {
  //   t.equal(event.topic, 'send')
  //   // console.log(event)
  //   return Promise.resolve()
  // }

  let stoleSeq
  const stubPutSave = sandbox.stub(messages, 'save').callsFake(async (message) => {
    typeforce(types.message, message)
    t.notOk(message._inbound)
    t.equal(message[SEQ], nextSeq)
    t.equal(message[PREV_TO_RECIPIENT], prevMsgLink)
    if (!stoleSeq) {
      nextSeq++
      stoleSeq = true
      throw new Errors.Duplicate('stolen seq', prevMsgLink)
    }

    t.end()
  })

  const event = await _doQueueMessage({
    time: Date.now(),
    author: alice,
    recipient: bob.identity._permalink,
    object: payload
  })

  t.equal(stubPutObject.callCount, 1)
  // t.equal(stubReplaceEmbeds.callCount, 1)
  t.equal(stubPutSave.callCount, 2)
  t.equal(stubLastSeqAndLink.callCount, 2)
  sandbox.restore()

  // Events.putEvent = putEvent

  // TODO: compare

  // t.end()
}))

test('_doReceiveMessage', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const message = fromBobToAlice[0]
  const stubGetIdentity = sandbox.stub(identities, 'getPubKeyMapping').callsFake(mocks.getPubKeyMapping)
  const stubPutObject = sandbox.stub(objects, 'put').callsFake(function (object) {
    t.ok(object[SIG])
    t.same(object, message.object)
    return Promise.resolve()
  })

  const stubTimestampInc = sandbox.stub(messages,'assertTimestampIncreased').callsFake(promiseNoop)
  // const stubGetInbound = sandbox.stub(messages, 'getInboundByLink').callsFake(function (link) {
  //   throw new Errors.NotFound()
  // })

  const stubPutSave = sandbox.stub(messages, 'save').callsFake(function (message) {
    t.equal(message._inbound, true)
    typeforce(types.message, message)
    // console.log(event)
    return Promise.resolve()
  })

  await _doReceiveMessage({ message })
  t.equal(stubPutSave.callCount, 1)
  t.equal(stubPutObject.callCount, 1)
  t.equal(stubGetIdentity.callCount, 1)
  // t.equal(stubGetInbound.callCount, 0)
  t.equal(stubTimestampInc.callCount, yn(process.env.NO_TIME_TRAVEL) ? 1 : 0)
  // TODO: compare

  sandbox.restore()
  t.end()
}))

// only makes sense in the single-messages-table implementation
// (vs Inbox+Outbox)
// test.skip('getLastMessageFrom/To', loudAsync(async (t) => {
//   // start fresh
//   try {
//     await messages.table.destroy()
//   } catch (err) {}

//   await messages.table.create()

//   console.log('ALICE', alice.identity._permalink)
//   console.log('BOB', bob.identity._permalink)
//   for (let message of fromBobToAlice) {
//     message = clone(message)
//     message._inbound = true
//     await messages.save(message)
//     const last = await messages.getLastMessageFrom({
//       author: bob.identity._permalink,
//       body: false
//     })

//     t.same(last, messages.stripData(message))
//   }

//   for (let message of fromAliceToBob) {
//     await messages.save(message)
//     const last = await messages.getLastMessageTo({
//       recipient: bob.identity._permalink,
//       body: false
//     })

//     t.same(last, messages.stripData(message))
//   }

//   t.end()
// }))

// test('strip data', function (t) {
//   const time = Date.now()
//   const message = {
//     time,
//     link: 'a',
//     permalink: 'b',
//     author: 'c',
//     recipient: 'd',
//     sigPubKey: 'd1',
//     object: {
//       time,
//       [SIG]: 'asdjklasdjklsa',
//       [TYPE]: MESSAGE,
//       [SEQ]: 1,
//       context: 'abc',
//       object: {
//         [SIG]: 'sadjdlksa',
//         [TYPE]: 'tradle.SimpleMessage',
//         message: 'hey hey'
//       },
//       recipientPubKey: {
//         curve: 'p256',
//         pub: new Buffer('beefface', 'hex')
//       }
//     }
//   }

//   const wrapper = {
//     message,
//     payload: objects.addLinks({
//       author: message.author,
//       object: message.object.object
//     })
//   }

//   console.log(messages.stripData(wrapper))
//   t.same(messages.stripData(wrapper))
// })

// test.only('sign/verify1', function (t) {
//   const key = ecdsa.genSync({ curve: 'p256' })
//   const KeyEncoder = require('key-encoder')
//   const encoder = new KeyEncoder('p256')
//   console.log(encoder.encodePublic(new Buffer(key.toJSON().pub, 'hex'), 'raw', 'pem'))
//   console.log(exportKeys([key])[0].encoded.pem.pub)
//   // console.log(key.toJSON(true))
//   // const data = new Buffer('some shit')
//   // const sig = key.signSync(data)
//   // console.log(key.verifySync(data, sig))
// })

// test('sign/verify', loudAsync(async (t) => {
//   const carol = await pify(newIdentity)({ networkName: 'testnet' })
//   const exported = carol.keys.map(key => key.toJSON(true))
//   console.log(exported.find(key => key.curve === 'p256'))
//   const keys = exportKeys(carol.keys)
//   const key = getSigningKey(keys)
//   const object = {
//     _t: 'tradle.SimpleMessage',
//     message: 'hey'
//   }

//   const signed = await sign({ key, object })
//   const pub = extractSigPubKey(signed.object)
//   t.same(pub.pub, key.pub)
//   t.end()
// }))

// test.only('handshake', loudAsync(async (t) => {
//   const client =
//   await onRequestTemporaryIdentity({ accountId: 'abc', clientId })

// }))

const mocks = {
  byPermalink: async (permalink) => {
    if (permalink === alice.identity._permalink) {
      return alice.identity
    }
    if (permalink === bob.identity._permalink) {
      return bob.identity
    }

    throw new Errors.NotFound('identity not found by permalink: ' + permalink)
  },
  // byPub: async (pub) => {
  //   const found = [alice, bob].find(info => {
  //     return info.identity.pubkeys.some(key => key.pub === pub)
  //   })

  //   if (found) return found.identity

  //   throw new Errors.NotFound('identity not found by pub: ' + pub)
  // },
  getPubKeyMapping: async ({ pub }) => {
    const found = [alice, bob].find(info => {
      return info.identity.pubkeys.some(key => key.pub === pub)
    })

    if (found) {
      return {
        link: found.identity._link,
        permalink: found.identity._permalink
      }
    }

    throw new Errors.NotFound('identity not found by pub: ' + pub)
  }
}
