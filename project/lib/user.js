const debug = require('debug')('tradle:sls:user')
const { co, getLink, typeforce, clone, omitVirtual } = require('./utils')
const { prettify } = require('./string-utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const Messages = require('./messages')
const { createReceiveMessageEvent } = require('./provider')
const Iot = require('./iot-utils')
const { invoke } = require('./lambda-utils')
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants')
const Buckets = require('./buckets')
const { SERVERLESS_STAGE, BOT_ONMESSAGE, IOT_TOPIC_PREFIX } = require('./env')
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
  debug(`delivering messages after time ${gt}`)
  yield Delivery.deliverMessages({ clientId, permalink, gt })
})

// const onSentMessageOverMQTT = co(function* ({ clientId, message }) {
//   try {
//     yield onSentMessage({ message })
//   } catch (err) {}
// })

const onSentMessage = co(function* ({ clientId, message }) {
  let err
  let processed
  try {
    processed = yield _onSentMessage({ clientId, message })
  } catch (e) {
    err = e
  }

  if (processed) {
    debug('received valid message from user')
    // SUCCESS!
    yield Delivery.ack({
      clientId,
      message: processed
    })

    if (!BOT_ONMESSAGE) {
      debug('no bot subscribed to "onmessage"')
      return
    }

    // const { author, time, link } = wrapper.message
    const neutered = Messages.stripData(processed)
    yield invoke({
      sync: false,
      name: BOT_ONMESSAGE,
      arg: neutered

      // arg: JSON.stringify({ author, time, link })
    })

    return processed
  }

  debug('processing error in receive:', err.name)
  processed = err.progress
  if (err instanceof Errors.InvalidMessageFormat) {
    // HTTP
    if (!clientId) {
      err.code = 400
      throw err
    }

    yield Delivery.reject({
      clientId,
      message: processed,
      reason: err
    })
  } else if (err instanceof Errors.Duplicate) {
    debug('ignoring but acking duplicate message', prettify(processed))
    // HTTP
    if (!clientId) return

    yield Delivery.ack({
      clientId,
      message: processed
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
      message: processed,
      error: err
    })
  } else if (err instanceof Errors.NotFound) {
    debug('rejecting message, either sender or payload identity was not found')
    if (!clientId) {
      err.code = 400
      throw err
    }

    yield Delivery.reject({
      clientId,
      message: processed,
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
    err.progress = message
    debug('unexpected error in pre-processing inbound message:', err.stack)
    throw err
  }

  try {
    return yield createReceiveMessageEvent({ message })
  } catch (err) {
    err.progress = message
    throw err
  }
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
  const { object } = yield Buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
  return omitVirtual(object)
})

const onGetInfo = co(function* () {
  const conf = yield Buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.info)
  conf.aws = true
  conf.iotTopicPrefix = IOT_TOPIC_PREFIX
  return conf
})

//   return yield {
//     style: getProviderStyle(),
//     identity: getProviderIdentity(),
//     authEndpoint: `https://${event.headers.Host}/${SERVERLESS_STAGE}/tradle`
//   }
// })

// function getProviderStyle () {
//   return Buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.style)
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
