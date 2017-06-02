// const path = require('path')

// require('dotenv').config({ path: path.join(__dirname, '.env') })

process.env.NODE_ENV = 'test'

const test = require('tape')
const tradle = require('@tradle/engine')
const { SIG, SEQ, TYPE, TYPES } = tradle.constants
const { hexLink } = tradle.utils
const { extractSigPubKey } = require('../lib/crypto')
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

const mocks = {
  getIdentityByPermalink: co(function* ({ permalink }) {
    if (permalink === alice.permalink) return omit(alice, 'keys')
    if (permalink === bob.permalink) return omit(bob, 'keys')
    throw new NotFound('identity not found by permalink: ' + permalink)
  }),
  getIdentityByPub: co(function* ({ pub }) {
    const found = [alice, bob].find(info => {
      return info.object.pubkeys.some(key => key.pub === pub)
    })

    if (found) return found

    throw new NotFound('identity not found by pub: ' + pub)
  }),
  getIdentityMetadataByPub: co(function* ({ pub }) {
    const found = [alice, bob].find(info => {
      return info.object.pubkeys.some(key => key.pub === pub)
    })

    if (found) return omit(found, ['keys', 'object'])

    throw new NotFound('identity not found by pub: ' + pub)
  })
}
