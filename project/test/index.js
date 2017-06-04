// const path = require('path')

// require('dotenv').config({ path: path.join(__dirname, '.env') })

process.env.IS_LOCAL = '1'
const extend = require('xtend/mutable')
extend(process.env, {
  CF_ObjectsBucket: 'ObjectsBucket',
  CF_SecretsBucket: 'SecretsBucket',
  CF_EventsTable: 'tradle-messaging-dev-EventsTable',
  CF_InboxTable: 'tradle-messaging-dev-InboxTable',
  CF_OutboxTable: 'tradle-messaging-dev-OutboxTable',
  CF_PubKeysTable: 'tradle-messaging-dev-PubKeysTable',
  CF_PresenceTable: 'tradle-messaging-dev-PresenceTable',
  CF_IotClientRole: 'IotClientRole'
})

const awsMock = require('aws-sdk-mock')
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
const { loudCo, omit, co } = require('../lib/utils')
const Objects = require('../lib/objects')
const { createSendMessageEvent, createReceiveMessageEvent } = require('../lib/author')
const { MESSAGE } = TYPES
const { InvalidSignatureError, NotFound } = require('../lib/errors')
const { METADATA_PREFIX, PAYLOAD_PROP_PREFIX } = require('../lib/constants')
const Identities = require('../lib/identities')
const Messages = require('../lib/messages')
const Events = require('../lib/events')
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
    t.ok(err instanceof InvalidSignatureError)
  }

  t.end()
})

test('format message', function (t) {
  const message = {
    link: 'a',
    permalink: 'b',
    author: 'c',
    recipient: 'd',
    sigPubKey: 'd1',
    object: {
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
    _s: 'asdjklasdjklsa',
    seq: 1,
    context: 'abc',
    recipientPubKey: 'p256:beefface'
  })

  const recovered = Messages.messageFromEventPayload(formatted)
  recovered.message.object.object = message.object.object
  recovered.payload.object = message.object.object
  t.same(recovered.message, message)
  t.same(recovered.payload, payload)
  t.end()
})

// test('createSendMessageEvent', loudCo(function* (t) {
//   t.plan(3)

//   const { putObject } = Objects
//   const { putEvent } = Events
//   const { getIdentityByPermalink } = Identities
//   const { getNextSeq } = Messages
//   const payload = {
//     [TYPE]: 'tradle.SimpleMessage',
//     message: 'hey bob'
//   }

//   // AWS.mock('S3', 'getObject', '')
//   Identities.getIdentityByPermalink = mocks.getIdentityByPermalink
//   Messages.getNextSeq = () => Promise.resolve(0)

//   Objects.putObject = function ({ link, object }) {
//     t.ok(object[SIG])
//     payload[SIG] = object[SIG]
//     t.same(object, payload)
//     return Promise.resolve()
//   }

//   Events.putEvent = function (event) {
//     t.equal(event.topic, 'send')
//     // console.log(event)
//     return Promise.resolve()
//   }

//   const event = yield createSendMessageEvent({
//     author: alice,
//     recipient: bob.permalink,
//     object: payload
//   })

//   Messages.getNextSeq = getNextSeq
//   Identities.getIdentityByPermalink = getIdentityByPermalink
//   Objects.putObject = putObject
//   Events.putEvent = putEvent

//   // TODO: compare

//   t.end()
// }))

// test('createReceiveMessageEvent', loudCo(function* (t) {
//   t.plan(3)

//   const message = toAliceFromBob
//   const { putObject } = Objects
//   const { putEvent } = Events
//   const { getIdentityByPermalink } = Identities

//   Identities.getIdentityMetadataByPub = mocks.getIdentityMetadataByPub
//   Objects.putObject = function ({ link, object }) {
//     t.ok(object[SIG])
//     t.same(object, message.object)
//     return Promise.resolve()
//   }

//   Events.putEvent = function (event) {
//     t.equal(event.topic, 'receive')
//     // console.log(event)
//     return Promise.resolve()
//   }

//   // awsMock.mock('S3', 'headObject', function (params) {
//   //   console.log('s3.headObject', arguments)
//   // })

//   // awsMock.mock('S3', 'getObject', function (params) {
//   //   console.log('s3.getObject', arguments)
//   // })

//   // awsMock.mock('S3', 'putObject', function ({ Bucket, Key, Body }) {
//   //   console.log('s3.putObject', arguments)
//   // })

//   // awsMock.mock('DynamoDB', 'putItem', function (params) {
//   //   console.log('DynamoDB.putItem', arguments)
//   // })

//   // awsMock.mock('DynamoDB.DocumentClient', 'get', wrap.sync(function ({ Key }) {
//   //   if (Key.pub) {
//   //     return {
//   //       Item: mocks.getIdentityByPub(Key.pub)
//   //     }
//   //   }

//   //   console.log(Key)
//   // }))

//   // awsMock.mock('DynamoDB.DocumentClient', 'put', function (params) {
//   //   console.log('docClient', arguments)
//   // })

//   const event = yield createReceiveMessageEvent({ message })

//   Identities.getIdentityMetadataByPub = getIdentityMetadataByPub
//   Objects.putObject = putObject
//   Events.putEvent = putEvent

//   // TODO: compare

//   t.end()
// }))

test('createSendMessageEvent', loudCo(function* (t) {
  t.plan(3)

  const { putObject } = Objects
  const { putEvent } = Events
  const { getIdentityByPermalink } = Identities
  const { getNextSeq } = Messages
  const payload = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'hey bob'
  }

  Identities.getIdentityByPermalink = mocks.getIdentityByPermalink
  Messages.getNextSeq = () => Promise.resolve(0)

  Objects.putObject = function ({ link, object }) {
    t.ok(object[SIG])
    payload[SIG] = object[SIG]
    t.same(object, payload)
    return Promise.resolve()
  }

  Events.putEvent = function (event) {
    t.equal(event.topic, 'send')
    // console.log(event)
    return Promise.resolve()
  }

  const event = yield createSendMessageEvent({
    author: alice,
    recipient: bob.permalink,
    object: payload
  })

  Messages.getNextSeq = getNextSeq
  Identities.getIdentityByPermalink = getIdentityByPermalink
  Objects.putObject = putObject
  Events.putEvent = putEvent

  // TODO: compare

  t.end()
}))

test('createReceiveMessageEvent', loudCo(function* (t) {
  t.plan(3)

  const message = toAliceFromBob
  const { putObject } = Objects
  const { putEvent } = Events
  const { getIdentityByPermalink } = Identities

  Identities.getIdentityMetadataByPub = mocks.getIdentityMetadataByPub
  Objects.putObject = function ({ link, object }) {
    t.ok(object[SIG])
    t.same(object, message.object)
    return Promise.resolve()
  }

  Events.putEvent = function (event) {
    t.equal(event.topic, 'receive')
    // console.log(event)
    return Promise.resolve()
  }

  const event = yield createReceiveMessageEvent({ message })

  Identities.getIdentityByPermalink = getIdentityByPermalink
  Objects.putObject = putObject
  Events.putEvent = putEvent

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

test.only('sign/verify', loudCo(function* (t) {
  const carol = yield pify(newIdentity)({ networkName: 'testnet' })
  const exported = carol.keys.map(key => key.toJSON(true))
  console.log(exported.find(key => key.curve === 'p256'))
  const keys = exportKeys(carol.keys)
  const key = getSigningKey(keys)
  const object = {
    _t: 'tradle.SimpleMessage',
    message: 'hey'
  }

  const signed = yield sign({ key, object })
  const pub = extractSigPubKey(signed.object)
  t.same(pub.pub, key.pub)
  t.end()
}))

// test.only('handshake', loudCo(function* (t) {
//   const clientId = alice.permalink + ':alice1'
//   yield onRequestTemporaryIdentity({ accountId: 'abc', clientId })

// }))

const mocks = {
  getIdentityByPermalink: co(function* (permalink) {
    if (permalink === alice.permalink) return omit(alice, 'keys')
    if (permalink === bob.permalink) return omit(bob, 'keys')
    throw new NotFound('identity not found by permalink: ' + permalink)
  }),
  getIdentityByPub: co(function* (pub) {
    const found = [alice, bob].find(info => {
      return info.object.pubkeys.some(key => key.pub === pub)
    })

    if (found) return found

    throw new NotFound('identity not found by pub: ' + pub)
  }),
  getIdentityMetadataByPub: co(function* (pub) {
    const found = [alice, bob].find(info => {
      return info.object.pubkeys.some(key => key.pub === pub)
    })

    if (found) return omit(found, ['keys', 'object'])

    throw new NotFound('identity not found by pub: ' + pub)
  })
}
