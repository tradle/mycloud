const debug = require('debug')('tradle:sls:author')
const pify = require('pify')
const { utils, protocol, typeforce, constants } = require('@tradle/engine')
const wrap = require('./wrap')
const signBuffer = require('./crypto').sign
const Objects = require('./objects')
const Secrets = require('./secrets')
// const { saveIdentityAndKeys } = require('./identities')
const { cachifyPromiser, loudCo, pick, omit, extend, co } = require('./utils')
const Messages = require('./messages')
const { getObjectByLink, extractMetadata } = require('./objects')
const Identities = require('./identities')
const Events = require('./events')
const { MessageNotForMe } = require('./errors')
const { PAYLOAD_PROP_PREFIX, IDENTITY_KEYS_KEY } = require('./constants')
const types = require('./types')
const doSign = pify(protocol.sign.bind(protocol))
const { TYPE, TYPES, SEQ, SIG } = constants
const { MESSAGE } = TYPES

// const DECRYPTION_KEY = new Buffer(process.env.DECRYPTION_KEY, 'base64')

// TODO: store identity in separate bucket

const lookupMyIdentity = loudCo(function* () {
  const { Body } = yield Secrets.getSecretObject(IDENTITY_KEYS_KEY)
  return JSON.parse(Body)
})

// TODO: how to invalidate cache on identity updates?
// maybe ETag on bucket item? But then we still need to request every time..
const getMyIdentity = cachifyPromiser(lookupMyIdentity)

function getSigningKey (keys) {
  return keys.find(key => key.type === 'ec' && key.purpose === 'sign')
}

function keyToSigner ({ curve, pub, encoded }) {
  const { priv } = encoded.pem
  return {
    sigPubKey: {
      curve,
      pub: new Buffer(pub)
    },
    sign: wrap.sync(data => signBuffer(priv, data))
  }
}

const sign = loudCo(function* ({ key, object }) {
  const { pub, priv } = key
  const author = keyToSigner(key)
  /* { object, merkleRoot } */
  const result = yield doSign({ object, author })

  return {
    sigPubKey: author.sigPubKey.pub.toString('hex'),
    object: result.object
  }
})

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
  const recipient = yield getMyIdentity()
  const myPubKey = recipient.object.pubkeys.find(pubKey => {
    return pubKey.pub === toPubKey
  })

  if (!myPubKey) {
    debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
    throw new MessageNotForMe(`message to pub key: ${toPubKey}`)
  }
})

module.exports = {
  getMyIdentity,
  sign,
  signObject,
  createSendMessageEvent,
  createReceiveMessageEvent
}
