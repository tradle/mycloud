require('./env')

// const awsMock = require('aws-sdk-mock')
const AWS = require('aws-sdk')
AWS.config.paramValidation = false

const test = require('tape')
const pify = require('pify')
const ecdsa = require('nkey-ecdsa')
const tradle = require('@tradle/engine')
const { SIG, SEQ, TYPE, TYPES } = tradle.constants
const { hexLink, newIdentity } = tradle.utils
const wrap = require('../lib/wrap')
const { extractSigPubKey, exportKeys, getSigningKey, sign } = require('../lib/crypto')
const { loudCo, omit, co, typeforce } = require('../lib/utils')
const Objects = require('../lib/objects')
const { createSendMessageEvent, createReceiveMessageEvent } = require('../lib/provider')
const { MESSAGE } = TYPES
const Errors = require('../lib/errors')
const { METADATA_PREFIX, PAYLOAD_PROP_PREFIX } = require('../lib/constants')
const Identities = require('../lib/identities')
const Messages = require('../lib/messages')
const Events = require('../lib/events')
const types = require('../lib/types')
const identity = require('./fixtures/identity-event')
const toAliceFromBob = Messages.normalizeInbound(require('./fixtures/alice/receive.json'))
const toBobFromAlice = require('./fixtures/bob/receive.json')
const [alice, bob] = ['alice', 'bob'].map(name => {
  const identity = require(`./fixtures/${name}/identity`)
  return {
    object: identity,
    link: tradle.utils.hexLink(identity),
    permalink: tradle.utils.hexLink(identity),
    keys: require(`./fixtures/${name}/keys`)
  }
})

test('extract pub key', function (t) {
  const { object } = identity
  const { curve, pub } = extractSigPubKey(object)
  const expected = object.pubkeys.find(key => {
    return key.purpose === 'update'
  })

  t.equal(curve, expected.curve)
  t.equal(pub, expected.pub)

  object.blah = 'blah'
  try {
    extractSigPubKey(object)
    t.fail('validated invalid signature')
  } catch (err) {
    t.ok(err instanceof Errors.InvalidSignature)
  }

  t.end()
})

test('format message', function (t) {
  const time = Date.now()
  const message = {
    time,
    link: 'a',
    permalink: 'b',
    author: 'c',
    recipient: 'd',
    sigPubKey: 'd1',
    object: {
      time,
      [SIG]: 'asdjklasdjklsa',
      [TYPE]: MESSAGE,
      [SEQ]: 1,
      context: 'abc',
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message: 'hey hey'
      },
      recipientPubKey: {
        curve: 'p256',
        pub: new Buffer('beefface', 'hex')
      }
    }
  }

  const payload = {
    link: 'e',
    permalink: 'f',
    type: 'g',
    author: 'h',
    sigPubKey: 'i',
    object: message.object.object
  }

  const formatted = Messages.messageToEventPayload({ message, payload })
  t.same(formatted, {
    [METADATA_PREFIX + 'time']: time,
    [METADATA_PREFIX + 'link']: 'a',
    [METADATA_PREFIX + 'permalink']: 'b',
    [METADATA_PREFIX + 'author']: 'c',
    [METADATA_PREFIX + 'recipient']: 'd',
    [METADATA_PREFIX + 'sigPubKey']: 'd1',
    [METADATA_PREFIX + PAYLOAD_PROP_PREFIX + 'link']: 'e',
    [METADATA_PREFIX + PAYLOAD_PROP_PREFIX + 'permalink']: 'f',
    [METADATA_PREFIX + PAYLOAD_PROP_PREFIX + 'type']: 'g',
    [METADATA_PREFIX + PAYLOAD_PROP_PREFIX + 'author']: 'h',
    [METADATA_PREFIX + PAYLOAD_PROP_PREFIX + 'sigPubKey']: 'i',
    [SIG]: 'asdjklasdjklsa',
    [SEQ]: 1,
    context: 'abc',
    recipientPubKey: 'p256:beefface',
    time
  })

  const recovered = Messages.messageFromEventPayload(formatted)
  recovered.message.object.object = message.object.object
  recovered.payload.object = message.object.object
  t.same(recovered.message, message)
  t.same(recovered.payload, payload)
  t.end()
})

test('createSendMessageEvent', loudCo(function* (t) {
  // t.plan(3)

  const { putObject } = Objects
  const { putEvent } = Events
  const { getIdentityByPermalink } = Identities
  const { getNextSeq, putMessage } = Messages
  const payload = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'hey bob'
  }

  Identities.getIdentityByPermalink = mocks.getIdentityByPermalink

  let nextSeq = 0
  Messages.getNextSeq = () => Promise.resolve(nextSeq)

  Objects.putObject = function ({ link, object }) {
    t.ok(object[SIG])
    payload[SIG] = object[SIG]
    t.same(object, payload)
    return Promise.resolve()
  }

  // Events.putEvent = function (event) {
  //   t.equal(event.topic, 'send')
  //   // console.log(event)
  //   return Promise.resolve()
  // }

  let stoleSeq
  Messages.putMessage = co(function* ({ message, payload }) {
    t.notOk(message.inbound)
    typeforce(types.messageWrapper, message)
    typeforce(types.payloadWrapper, payload)
    t.equal(message.object[SEQ], nextSeq)
    if (!stoleSeq) {
      nextSeq++
      stoleSeq = true
      const err = new Error()
      err.code = 'ConditionalCheckFailedException'
      throw err
    }

    t.end()
  })

  const wrapper = yield createSendMessageEvent({
    time: Date.now(),
    author: alice,
    recipient: bob.permalink,
    object: payload
  })

  Messages.getNextSeq = getNextSeq
  Messages.putMessage = putMessage
  Identities.getIdentityByPermalink = getIdentityByPermalink
  Objects.putObject = putObject
  // Events.putEvent = putEvent

  // TODO: compare

  // t.end()
}))

test('createReceiveMessageEvent', loudCo(function* (t) {
  t.plan(3)

  const message = toAliceFromBob
  const { putObject } = Objects
  const { getIdentityByPermalink, getIdentityMetadataByPub } = Identities
  const {
    getInboundByLink,
    putMessage,
    assertTimestampIncreased
  } = Messages

  Identities.getIdentityMetadataByPub = mocks.getIdentityMetadataByPub
  Objects.putObject = function ({ link, object }) {
    t.ok(object[SIG])
    t.same(object, message.object)
    return Promise.resolve()
  }

  Messages.assertTimestampIncreased = co(function* () {})

  Messages.getInboundByLink = function (link) {
    throw new Errors.NotFound()
  }

  Messages.putMessage = function ({ message, payload }) {
    t.equal(message.inbound, true)
    typeforce(types.messageWrapper, message)
    typeforce(types.payloadWrapper, payload)
    // console.log(event)
    return Promise.resolve()
  }

  yield createReceiveMessageEvent({ message })

  Identities.getIdentityMetadataByPub = getIdentityMetadataByPub
  // Identities.getIdentityByPermalink = getIdentityByPermalink
  Objects.putObject = putObject
  Messages.putMessage = putMessage
  Messages.getInboundByLink = getInboundByLink
  Messages.assertTimestampIncreased = assertTimestampIncreased

  // TODO: compare

  t.end()
}))

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

// test('sign/verify', loudCo(function* (t) {
//   const carol = yield pify(newIdentity)({ networkName: 'testnet' })
//   const exported = carol.keys.map(key => key.toJSON(true))
//   console.log(exported.find(key => key.curve === 'p256'))
//   const keys = exportKeys(carol.keys)
//   const key = getSigningKey(keys)
//   const object = {
//     _t: 'tradle.SimpleMessage',
//     message: 'hey'
//   }

//   const signed = yield sign({ key, object })
//   const pub = extractSigPubKey(signed.object)
//   t.same(pub.pub, key.pub)
//   t.end()
// }))

// test.only('handshake', loudCo(function* (t) {
//   const client =
//   yield onRequestTemporaryIdentity({ accountId: 'abc', clientId })

// }))

const mocks = {
  getIdentityByPermalink: co(function* (permalink) {
    if (permalink === alice.permalink) return omit(alice, 'keys')
    if (permalink === bob.permalink) return omit(bob, 'keys')
    throw new Errors.NotFound('identity not found by permalink: ' + permalink)
  }),
  getIdentityByPub: co(function* (pub) {
    const found = [alice, bob].find(info => {
      return info.object.pubkeys.some(key => key.pub === pub)
    })

    if (found) return found

    throw new Errors.NotFound('identity not found by pub: ' + pub)
  }),
  getIdentityMetadataByPub: co(function* (pub) {
    const found = [alice, bob].find(info => {
      return info.object.pubkeys.some(key => key.pub === pub)
    })

    if (found) return omit(found, ['keys', 'object'])

    throw new Errors.NotFound('identity not found by pub: ' + pub)
  })
}
