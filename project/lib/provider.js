const debug = require('debug')('tradle:sls:author')
const { utils, protocol, typeforce } = require('@tradle/engine')
const wrap = require('./wrap')
const { sign, getSigningKey, getChainKey, getLink, getPermalink } = require('./crypto')
const Objects = require('./objects')
const Secrets = require('./secrets')
// const { saveIdentityAndKeys } = require('./identities')
const { cachifyPromiser, loudCo, pick, omit, clone, co, timestamp } = require('./utils')
const Messages = require('./messages')
const { getObjectByLink, extractMetadata } = require('./objects')
const Buckets = require('./buckets')
const Identities = require('./identities')
const Events = require('./events')
const { getLiveSessionByPermalink } = require('./auth')
const { deliverBatch } = require('./delivery')
const { extend, setVirtual, pickVirtual } = require('./utils')
const Errors = require('./errors')
const types = require('./types')
const { network } = require('./')
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

const lookupMyIdentity = () => Secrets.get(IDENTITY_KEYS_KEY)
const lookupMyPublicIdentity = () => Buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)

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
  if (!author) author = yield getMyIdentity()

  const key = getSigningKey(author.keys)
  const signed = yield sign({ key, object })

  Objects.addMetadata(signed)
  setVirtual(signed, { _author: getPermalink(author.identity) })
  return signed
})

const findOrCreate = co(function* ({ link, object, author }) {
  if (!object) {
    return getObjectByLink(link)
  }

  let willPut
  if (!object[SIG]) {
    willPut = true
    object = yield signObject({ author, object })
  }

  yield Objects.replaceEmbeds(object)
  if (willPut) {
    yield Objects.putObject(object)
  }

  Objects.addMetadata(object)
  return object
})

const _createSendMessageEvent = co(function* (opts) {
  const { author, recipient, link, object, other={} } = opts

  typeforce({
    recipient: types.link,
    object: typeforce.maybe(typeforce.Object),
    other: typeforce.maybe(typeforce.Object),
  }, opts)

  // run in parallel
  const promisePayload = findOrCreate({ link, object, author })
  const promisePrev = Messages.getLastSeqAndLink({ recipient })
  const promiseRecipient = Identities.getIdentityByPermalink(recipient)
  const [payload, recipientObj] = yield [
    promisePayload,
    promiseRecipient
  ]

  const payloadVirtual = pickVirtual(payload)
  const unsignedMessage = clone(other, {
    [TYPE]: MESSAGE,
    recipientPubKey: utils.sigPubKey(recipientObj),
    object: payload,
    time: opts.time
  })

  // TODO:
  // efficiency can be improved
  // message signing can be done in parallel with putObject in findOrCreate

  let attemptsToGo = 3
  let prev = yield promisePrev
  while (attemptsToGo--) {
    extend(unsignedMessage, Messages.getPropsDerivedFromLast(prev))

    let seq = unsignedMessage[SEQ]
    debug(`signing message ${seq} to ${recipient}`)

    let signedMessage = yield signObject({ author, object: unsignedMessage })
    setVirtual(signedMessage, {
      _author: getPermalink(author.identity),
      _recipient: getPermalink(recipientObj)
    })

    setVirtual(signedMessage.object, payloadVirtual)

    try {
      yield Messages.putMessage(signedMessage)
      return signedMessage
    } catch (err) {
      if (err.code !== 'ConditionalCheckFailedException') {
        throw err
      }

      debug(`seq ${seq} was taken by another message`)
      prev = yield Messages.getLastSeqAndLink({ recipient })
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
  message = yield Messages.parseInbound(message)
  // TODO: phase this out
  yield Objects.putObject(message.object)

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

  yield Messages.putMessage(message)
  return message
})

// const ensureMessageIsForMe = co(function* ({ message }) {
//   const toPubKey = message.recipientPubKey.pub.toString('hex')
//   const recipient = yield getMyPublicIdentity()
//   const myPubKey = recipient.object.pubkeys.find(pubKey => {
//     return pubKey.pub === toPubKey
//   })

//   if (!myPubKey) {
//     debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
//     throw new Errors.MessageNotForMe(`message to pub key: ${toPubKey}`)
//   }
// })

const sendMessage = co(function* ({ recipient, object, other={} }) {
  // start this first to get a more accurate timestamp
  const promiseCreate = createSendMessageEvent({ recipient, object, other })
  const promiseSession = getLiveSessionByPermalink(recipient)
  const message = yield promiseCreate

  // should probably do this asynchronously
  try {
    yield attemptLiveDelivery({
      message,
      session: yield promiseSession
    })
  } catch (err) {
    if (!(err instanceof Errors.NotFound)) {
      // rethrow, as this is likely a developer error
      debug('live delivery failed', err)
      throw err
    }
  }

  return message
})

const attemptLiveDelivery = co(function* ({ message, session }) {
  debug(`sending message (time=${message.time}) to ${session.permalink} live`)
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
