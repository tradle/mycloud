const debug = require('debug')('tradle:sls:author')
const { utils, protocol, typeforce } = require('@tradle/engine')
const wrap = require('./wrap')
const { sign, getSigningKey, getChainKey } = require('./crypto')
const Objects = require('./objects')
const Secrets = require('./secrets')
// const { saveIdentityAndKeys } = require('./identities')
const { cachifyPromiser, loudCo, pick, omit, clone, co, timestamp } = require('./utils')
const Messages = require('./messages')
const { getObjectByLink, extractMetadata } = require('./objects')
const { PublicConfBucket } = require('./buckets')
const Identities = require('./identities')
const Events = require('./events')
const { getLiveSessionByPermalink } = require('./auth')
const { deliverBatch } = require('./delivery')
const Errors = require('./errors')
const types = require('./types')
const { network } = require('./tradle')
const {
  PAYLOAD_PROP_PREFIX,
  IDENTITY_KEYS_KEY,
  SEQ,
  TYPE,
  TYPES,
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
const getMyKeys = co(function* () {
  const { keys } = yield getMyIdentity()
  return keys
})

const getMyChainKey = co(function* () {
  const keys = yield Provider.getMyKeys()
  return getChainKey(keys, {
    type: network.flavor,
    networkName: network.networkName
  })
})

const signObject = co(function* ({ author, object }) {
  const key = getSigningKey(author.keys)
  const wrapper = yield sign({ key, object })

  Objects.addMetadata(wrapper)
  wrapper.author = author.permalink
  return wrapper
})

const findOrCreate = co(function* ({ link, object, author }) {
  if (object) {
    if (object[SIG]) {
      return Objects.addMetadata({ object })
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

  // run in parallel
  const promisePayload = findOrCreate({ link, object, author })
  const promiseSeq = Messages.getNextSeq({ recipient })
  const promiseRecipient = Identities.getIdentityByPermalink(recipient)
  const [payloadWrapper, recipientObj] = yield [
    promisePayload,
    promiseRecipient
  ]

  const unsignedMessage = clone(other, {
    [TYPE]: MESSAGE,
    recipientPubKey: utils.sigPubKey(recipientObj.object),
    object: payloadWrapper.object,
    time: opts.time
  })

  // TODO:
  // efficiency can be improved
  // message signing can be done in parallel with putObject in findOrCreate

  let attemptsToGo = 3
  let seq = yield promiseSeq
  while (attemptsToGo--) {
    debug(`signing message ${seq} to ${recipient}`)
    unsignedMessage[SEQ] = seq
    let signedMessage = yield signObject({ author, object: unsignedMessage })
    signedMessage.author = author.permalink
    signedMessage.recipient = recipientObj.permalink
    signedMessage.time = opts.time

    let wrapper = {
      message: signedMessage,
      payload: payloadWrapper
    }

    try {
      yield Messages.putMessage(wrapper)
      return wrapper
    } catch (err) {
      if (err.code !== 'ConditionalCheckFailedException') {
        throw err
      }

      debug(`seq ${seq} was taken by another message`)
      seq = yield Messages.getNextSeq({ recipient })
      debug(`retrying with seq ${seq}`)
    }
  }

  const err = new Errors.PutFailed('failing after 3 retries')
  err.retryable = true
  throw err
})

const createSendMessageEvent = co(function* (opts) {
  if (!opts.time) {
    opts.time = Date.now()
  }

  if (!opts.author) {
    opts.author = yield getMyIdentity()
  }

  return _createSendMessageEvent(opts)
})

const createReceiveMessageEvent = co(function* ({ message }) {
  const wrapper = yield Messages.parseInbound({ message })
  yield Objects.putObject(wrapper.payload)

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

  yield Messages.putMessage(wrapper)
  return wrapper
})

const ensureMessageIsForMe = co(function* ({ message }) {
  const toPubKey = message.recipientPubKey.pub.toString('hex')
  const recipient = yield getMyPublicIdentity()
  const myPubKey = recipient.object.pubkeys.find(pubKey => {
    return pubKey.pub === toPubKey
  })

  if (!myPubKey) {
    debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
    throw new Errors.MessageNotForMe(`message to pub key: ${toPubKey}`)
  }
})

const sendMessage = co(function* ({ recipient, object, other={} }) {
  // start this first to get a more accurate timestamp
  const promiseCreate = createSendMessageEvent({ recipient, object, other })
  const promiseSession = getLiveSessionByPermalink(recipient)
  const { message } = yield promiseCreate

  let session
  try {
    session = yield promiseSession
  } catch (err) {
    return
  }

  debug(`sending message (time=${message.time}) to ${recipient} live`)
  yield deliverBatch({
    clientId: session.clientId,
    permalink: session.permalink,
    messages: [message]
  })
})

const Provider = module.exports = {
  getMyKeys,
  getMyChainKey,
  getMyIdentity: getMyPublicIdentity,
  signObject,
  createSendMessageEvent,
  createReceiveMessageEvent,
  sendMessage
}
