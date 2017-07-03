const debug = require('debug')('tradle:sls:user')
const { co, getLink, typeforce, clone } = require('./utils')
const { prettify } = require('./string-utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const Messages = require('./messages')
const { createReceiveMessageEvent } = require('./provider')
const Iot = require('./iot-utils')
const { invoke } = require('./lambda-utils')
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants')
const Buckets = require('./buckets')
const { SERVERLESS_STAGE, BOT_ONMESSAGE } = require('./env')
const Errors = require('./errors')
const types = require('./types')

const onSubscribed = co(function* ({ clientId, topics }) {
  debug('client subscribed to topics:', topics.join(', '))
  // yield onEnter({ clientId })

  if (!Iot.includesClientMessagesTopic({ clientId, topics })) return

  const session = yield Auth.getSession({ clientId })
  debug('retrieved session', prettify(session))
  const { permalink, clientPosition, serverPosition } = session
  const gt = (clientPosition.received && clientPosition.received.time) || 0
  yield Delivery.deliverMessages({ clientId, permalink, gt })
})

// const onSentMessageOverMQTT = co(function* ({ clientId, message }) {
//   try {
//     yield onSentMessage({ message })
//   } catch (err) {}
// })

const onSentMessage = co(function* ({ clientId, message }) {
  let err
  let wrapper
  try {
    wrapper = yield _onSentMessage({ clientId, message })
  } catch (e) {
    err = e
  }

  if (wrapper) {
    // SUCCESS!
    yield Delivery.ack({
      clientId,
      message: wrapper.message
    })

    if (!BOT_ONMESSAGE) {
      debug('no bot subscribed to "onmessage"')
      return
    }

    // const { author, time, link } = wrapper.message
    const neutered = Messages.stripData(wrapper)
    yield invoke({
      sync: false,
      name: BOT_ONMESSAGE,
      arg: neutered

      // arg: JSON.stringify({ author, time, link })
    })

    return wrapper
  }

  debug('processing error in receive:', err.name)
  wrapper = err.progress
  if (err instanceof Errors.InvalidMessageFormat) {
    // HTTP
    if (!clientId) {
      err.code = 400
      throw err
    }

    yield Delivery.reject({
      clientId,
      message: wrapper,
      reason: err
    })
  } else if (err instanceof Errors.Duplicate) {
    debug('ignoring but acking duplicate message', prettify(wrapper))
    // HTTP
    if (!clientId) return

    yield Delivery.ack({
      clientId,
      message: wrapper
    })
  } else if (err instanceof Errors.TimeTravel) {
    // HTTP
    debug('rejecting message with lower timestamp than previous')
    if (!clientId) {
      err.code = 400
      throw err
    }

    yield Delivery.reject({
      clientId,
      message: err.wrapper,
      error: err
    })
  } else if (err instanceof Errors.NotFound) {
    debug('rejecting message, sender identity not found')
    if (!clientId) {
      err.code = 400
      throw err
    }

    yield Delivery.reject({
      clientId,
      message: 'sender identity not found',
      error: err
    })
  } else {
    debug('unexpected error in pre-processing inbound message:', err.stack)
    throw err
  }
})

const _onSentMessage = co(function* ({ clientId, message }) {
  // can probably move this to lamdba
  // as it's normalizing transport-mangled inputs
  try {
    message = Messages.normalizeInbound(message)
    message = yield Messages.preProcessInbound(message)
  } catch (err) {
    err.progress = { object: message }
    debug('unexpected error in pre-processing inbound message:', err.stack)
    throw err
  }

  let wrapper
  try {
    wrapper = yield createReceiveMessageEvent({ message })
  } catch (err) {
    err.progress = { object: message }
    throw err
  }

  return wrapper
})

const onDisconnected = function ({ clientId }) {
  return Auth.updatePresence({ clientId, connected: false })
}

const onConnected = function ({ clientId }) {
  return Auth.updatePresence({ clientId, connected: true })
}

const onPreAuth = Auth.getTemporaryIdentity
const onSentChallengeResponse = co(function* (response) {
  const time = Date.now()
  const session = yield Auth.handleChallengeResponse(response)
  return {
    time,
    position: session.serverPosition
  }
})

const onRestoreRequest = co(function* ({ clientId, gt, lt }) {
  let session
  try {
    session = yield Auth.getMostRecentSessionByClientId(clientId)
  } catch (err) {}

  if (!session) {
    debug(`ignoring "restore" request from outdated session: ${clientId}`)
    return
  }

  yield Delivery.deliverMessages({
    clientId: session.clientId,
    permalink: session.permalink,
    gt,
    lt
  })
})

const getProviderIdentity = co(function* () {
  const { object } = yield Buckets.PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.identity)
  return object
})

const onGetInfo = () => Buckets.PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.info)
//   return yield {
//     style: getProviderStyle(),
//     identity: getProviderIdentity(),
//     authEndpoint: `https://${event.headers.Host}/${SERVERLESS_STAGE}/tradle`
//   }
// })

// function getProviderStyle () {
//   return Buckets.PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.style)
//     .catch(err => {
//       debug('no styles found', err)
//       return {}
//     })
// }

module.exports = {
  onSentChallengeResponse,
  onPreAuth,
  onConnected,
  onDisconnected,
  onSubscribed,
  onSentMessage,
  onRestoreRequest,
  onGetInfo
}
