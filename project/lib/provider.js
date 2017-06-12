const debug = require('debug')('tradle:sls:author')
const { utils, protocol, typeforce } = require('@tradle/engine')
const wrap = require('./wrap')
const { sign, getSigningKey } = require('./crypto')
const Objects = require('./objects')
const Secrets = require('./secrets')
// const { saveIdentityAndKeys } = require('./identities')
const { cachifyPromiser, loudCo, pick, omit, extend, co } = require('./utils')
const Messages = require('./messages')
const { getObjectByLink, extractMetadata } = require('./objects')
const { PublicConfBucket } = require('./buckets')
const Identities = require('./identities')
const Events = require('./events')
const { MessageNotForMe } = require('./errors')
const types = require('./types')
const {
  PAYLOAD_PROP_PREFIX,
  IDENTITY_KEYS_KEY,
  TYPE,
  TYPES,
  SEQ,
  SIG,
  PUBLIC_CONF_BUCKET
} = require('./constants')

const { MESSAGE } = TYPES

// const DECRYPTION_KEY = new Buffer(process.env.DECRYPTION_KEY, 'base64')

// TODO: store identity in separate bucket

const lookupMyIdentity = loudCo(function* () {
  const { Body } = yield Secrets.getSecretObject(IDENTITY_KEYS_KEY)
  return JSON.parse(Body)
})

function lookupMyPublicIdentity () {
  return PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.identity)
}

// TODO: how to invalidate cache on identity updates?
// maybe ETag on bucket item? But then we still need to request every time..
const getMyIdentity = cachifyPromiser(lookupMyIdentity)
const getMyPublicIdentity = cachifyPromiser(lookupMyPublicIdentity)

const signObject = co(function* ({ author, object }) {
  const wrapper = yield sign({
    key: getSigningKey(author.keys),
    object
  })

  utils.addLinks(wrapper)
  wrapper.author = author.permalink
  return wrapper
})

const findOrCreate = co(function* ({ link, object, author }) {
  if (object) {
    if (object[SIG]) {
      return utils.addLinks({ object })
    }

    const result = yield signObject({ author, object })
    yield Objects.putObject(result)
    return result
  }

  return getObjectByLink(link)
})

const _createSendMessageEvent = co(function* (opts) {
  const { author, recipient, link, object, other={} } = opts

  typeforce({
    recipient: types.link,
    link: typeforce.maybe(types.link),
    object: typeforce.maybe(typeforce.Object),
    other: typeforce.maybe(typeforce.Object),
  }, opts)

  const promisePayload = findOrCreate({ link, object, author })
  const promiseSeq = Messages.getNextSeq({ recipient })
  const promiseRecipient = Identities.getIdentityByPermalink(recipient)
  const [payloadWrapper, recipientObj] = yield [
    promisePayload,
    promiseRecipient
  ]

  // TODO:
  // efficiency can be improved
  // message signing can be done in parallel with putObject in findOrCreate
  const unsignedMessage = extend(other, {
    [TYPE]: MESSAGE,
    [SEQ]: yield promiseSeq,
    recipientPubKey: utils.sigPubKey(recipientObj.object),
    object: payloadWrapper.object
  })

  const signedMessage = yield signObject({ author, object: unsignedMessage })
  signedMessage.author = author.permalink
  signedMessage.recipient = recipientObj.permalink
  const data = Messages.messageToEventPayload({
    message: signedMessage,
    payload: payloadWrapper
  })

  const putEvent = Events.putEvent({
    topic: 'send',
    data: data
  })

  const putMessage = Messages.putMessage(data)
  yield Promise.all([putEvent, putMessage])
  return signedMessage
})

const createSendMessageEvent = co(function* (opts) {
  if (!opts.author) {
    opts = extend({
      author: yield getMyIdentity()
    }, opts)
  }

  return _createSendMessageEvent(opts)
})

const createReceiveMessageEvent = co(function* ({ message }) {
  const parsed = yield Messages.parseInbound({ message })
  yield Objects.putObject(parsed.payload)

  // if (objectWrapper.type === IDENTITY && messageWrapper.sigPubKey === objectWrapper.sigPubKey) {
  //   // special case: someone is sending us their own identity

  //   // TODO: validate identity
  //   // yield getIdentityByPubKey(objectWrapper.sigPubKey)

  //   const { link, permalink, sigPubKey } = objectWrapper
  //   yield Events.putEvent({
  //     topic: 'addcontact',
  //     link,
  //     permalink,
  //     sigPubKey
  //   })
  // }

  const data = Messages.messageToEventPayload(parsed)
  data.inbound = true

  const putEvent = Events.putEvent({
    topic: 'receive',
    data: data
  })

  const putMessage = Messages.putMessage(data)
  yield Promise.all([putEvent, putMessage])
})

const ensureMessageIsForMe = co(function* ({ message }) {
  const toPubKey = message.recipientPubKey.pub.toString('hex')
  const recipient = yield getMyPublicIdentity()
  const myPubKey = recipient.object.pubkeys.find(pubKey => {
    return pubKey.pub === toPubKey
  })

  if (!myPubKey) {
    debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
    throw new MessageNotForMe(`message to pub key: ${toPubKey}`)
  }
})

module.exports = {
  getMyIdentity: getMyPublicIdentity,
  signObject,
  createSendMessageEvent,
  createReceiveMessageEvent
}
