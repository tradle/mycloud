const debug = require('debug')('tradle:sls:author')
const { utils } = require('@tradle/engine')
const { sign, getSigningKey, getChainKey, getLink, getPermalink } = require('./crypto')
const {
  cachifyPromiser,
  loudCo,
  extend,
  pick,
  omit,
  clone,
  co,
  timestamp,
  setVirtual,
  pickVirtual,
  typeforce,
  bindAll
} = require('./utils')

const Errors = require('./errors')
const types = require('./typeforce-types')
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

module.exports = Provider

function Provider (tradle) {
  bindAll(this)

  this.tradle = tradle
  this.objects = tradle.objects
  this.messages = tradle.messages
  this.secrets = tradle.secrets
  this.identities = tradle.identities
  this.buckets = tradle.buckets
  this.auth = tradle.auth
  this.network = tradle.network
}

const proto = Provider.prototype

proto.lookupMyIdentity = function () {
  return this.secrets.get(IDENTITY_KEYS_KEY)
}

proto.lookupMyPublicIdentity = function () {
  return this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
}

// TODO: how to invalidate cache on identity updates?
// maybe ETag on bucket item? But then we still need to request every time..
proto.getMyPrivateIdentity = cachifyPromiser(proto.lookupMyIdentity)
proto.getMyPublicIdentity = cachifyPromiser(proto.lookupMyPublicIdentity)
proto.getMyKeys = co(function* () {
  const { keys } = yield this.getMyPrivateIdentity()
  return keys
})

proto.getMyChainKey = co(function* () {
  const { network } = this
  const keys = yield this.getMyKeys()
  const chainKey = getChainKey(keys, {
    type: network.flavor,
    networkName: network.networkName
  })

  if (!chainKey) {
    throw new Error(`blockchain key not found for network: ${network}`)
  }

  return chainKey
})

proto.getMyChainKeyPub = co(function* () {
  const { network } = this
  const identity = yield this.getMyPublicIdentity()
  const key = identity.pubkeys.find(key => {
    return key.type === network.flavor &&
      key.networkName === network.networkName &&
      key.purpose === 'messaging'
  })

  if (!key) {
    throw new Error(`no key found for blockchain network ${network.toString()}`)
  }

  return key
})

proto.signObject = co(function* ({ author, object }) {
  if (!author) author = yield this.getMyPrivateIdentity()

  const key = getSigningKey(author.keys)
  const signed = yield sign({ key, object })

  this.objects.addMetadata(signed)
  setVirtual(signed, { _author: getPermalink(author.identity) })
  return signed
})

proto.findOrCreate = co(function* ({ link, object, author }) {
  if (!object) {
    return this.objects.getObjectByLink(link)
  }

  if (!object[SIG]) {
    object = yield this.signObject({ author, object })
  }

  yield this.objects.putObject(object)
  this.objects.addMetadata(object)
  return object
})

proto._createSendMessageEvent = co(function* (opts) {
  const { author, recipient, link, object, other={} } = opts

  typeforce({
    recipient: types.link,
    object: typeforce.maybe(typeforce.Object),
    other: typeforce.maybe(typeforce.Object),
  }, opts)

  // run in parallel
  const promisePayload = this.findOrCreate({ link, object, author })
  const promisePrev = this.messages.getLastSeqAndLink({ recipient })
  const promiseRecipient = this.identities.getIdentityByPermalink(recipient)
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
    extend(unsignedMessage, this.messages.getPropsDerivedFromLast(prev))

    let seq = unsignedMessage[SEQ]
    debug(`signing message ${seq} to ${recipient}`)

    let signedMessage = yield this.signObject({ author, object: unsignedMessage })
    setVirtual(signedMessage, {
      _author: getPermalink(author.identity),
      _recipient: getPermalink(recipientObj)
    })

    setVirtual(signedMessage.object, payloadVirtual)

    try {
      yield this.messages.putMessage(signedMessage)
      return signedMessage
    } catch (err) {
      if (err.code !== 'ConditionalCheckFailedException') {
        throw err
      }

      debug(`seq ${seq} was taken by another message`)
      prev = yield this.messages.getLastSeqAndLink({ recipient })
      debug(`retrying with seq ${seq}`)
    }
  }

  const err = new Errors.PutFailed('failing after 3 retries')
  err.retryable = true
  throw err
})

proto.createSendMessageEvent = co(function* (opts) {
  if (!opts.time) {
    opts.time = Date.now()
  }

  if (!opts.author) {
    opts.author = yield this.getMyPrivateIdentity()
  }

  return this._createSendMessageEvent(opts)
})

proto.receiveMessage = co(function* ({ message }) {
  // can probably move this to lamdba
  // as it's normalizing transport-mangled inputs
  try {
    message = this.messages.normalizeInbound(message)
    message = yield this.messages.preProcessInbound(message)
  } catch (err) {
    err.progress = message
    debug('unexpected error in pre-processing inbound message:', err.stack)
    throw err
  }

  try {
    return yield this.createReceiveMessageEvent({ message })
  } catch (err) {
    err.progress = message
    throw err
  }
})

proto.createReceiveMessageEvent = co(function* ({ message }) {
  message = yield this.messages.parseInbound(message)
  // TODO: phase this out
  yield this.objects.putObject(message.object)

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

  yield this.messages.putMessage(message)
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

proto.sendMessage = co(function* ({ recipient, object, other={} }) {
  // start this first to get a more accurate timestamp
  const promiseCreate = this.createSendMessageEvent({ recipient, object, other })
  const promiseSession = this.auth.getLiveSessionByPermalink(recipient)
  const message = yield promiseCreate

  // should probably do this asynchronously
  try {
    yield this.attemptLiveDelivery({
      message,
      session: yield promiseSession
    })
  } catch (err) {
    if (err instanceof Errors.NotFound) {
      debug('live delivery canceled', err.stack)
    } else {
      // rethrow, as this is likely a developer error
      debug('live delivery failed', err)
      throw err
    }
  }

  return message
})

proto.attemptLiveDelivery = co(function* ({ message, session }) {
  debug(`sending message (time=${message.time}) to ${session.permalink} live`)
  yield this.tradle.delivery.deliverBatch({
    clientId: session.clientId,
    recipient: session.permalink,
    messages: [message]
  })
})
