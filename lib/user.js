const debug = require('debug')('tradle:sls:user')
const { co, getLink, typeforce, clone, omitVirtual, bindAll } = require('./utils')
const { prettify } = require('./string-utils')
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants')
const Errors = require('./errors')
const types = require('./typeforce-types')

module.exports = UserSim

/**
 * simulates user actions, e.g.
 *  a user sending us a message
 *  a user subscribing to a topic
 *  a user calling his grandma on her birthday
 */
function UserSim ({
  env,
  auth,
  iot,
  provider,
  delivery,
  buckets,
  messages,
  lambdaUtils
}) {
  bindAll(this)

  this.env = env
  this.auth = auth
  this.iot = iot
  this.provider = provider
  this.delivery = delivery
  this.buckets = buckets
  this.messages = messages
  this.lambdaUtils = lambdaUtils
}

const proto = UserSim.prototype

proto.onSubscribed = co(function* ({ clientId, topics }) {
  debug('client subscribed to topics:', topics.join(', '))
  // yield onEnter({ clientId })

  if (!this.iot.includesClientMessagesTopic({ clientId, topics })) return

  const session = yield this.auth.getSession({ clientId })
  debug('retrieved session', prettify(session))
  const { permalink, clientPosition, serverPosition } = session
  const after = (clientPosition.received && clientPosition.received.time) || 0
  debug(`delivering messages after time ${after}`)
  yield this.delivery.deliverMessages({
    clientId,
    recipient: permalink,
    range: { after }
  })
})

// const onSentMessageOverMQTT = co(function* ({ clientId, message }) {
//   try {
//     yield onSentMessage({ message })
//   } catch (err) {}
// })

proto.onSentMessage = co(function* ({ clientId, message }) {
  const { TESTING } = this.env

  let err
  let processed
  try {
    processed = yield this.provider.receiveMessage({ message })
  } catch (e) {
    // delivery http
    if (!clientId) throw e

    err = e
  }

  if (processed) {
    // SUCCESS!
    debug('received valid message from user')

    yield this.delivery.ack({
      clientId,
      message: processed
    })

    const { BOT_ONMESSAGE } = this.env
    if (!BOT_ONMESSAGE) {
      debug('no bot subscribed to "onmessage"')
      return
    }

    // const { author, time, link } = wrapper.message
    const neutered = this.messages.stripData(processed)
    debug(`passing message from ${processed._author} on to bot`)
    const resp = yield this.lambdaUtils.invoke({
      sync: TESTING,
      name: BOT_ONMESSAGE,
      arg: neutered
      // arg: JSON.stringify({ author, time, link })
    })

    return TESTING ? resp : processed
  }

  debug('processing error in receive:', err.name)
  processed = err.progress
  if (err instanceof Errors.Duplicate) {
    debug('ignoring but acking duplicate message', prettify(processed))
    // HTTP
    if (!clientId) return

    yield this.delivery.ack({
      clientId,
      message: processed
    })

    return
  }

  if (err instanceof Errors.TimeTravel ||
    err instanceof Errors.NotFound ||
    err instanceof Errors.InvalidSignature ||
    err instanceof Errors.InvalidMessageFormat) {
    // HTTP
    let logMsg
    if (err instanceof Errors.TimeTravel) {
      logMsg = 'rejecting message with lower timestamp than previous'
    } else if (err instanceof Errors.NotFound) {
      logMsg = 'rejecting message, either sender or payload identity was not found'
    } else if (err instanceof Errors.InvalidMessageFormat) {
      logMsg = 'rejecting message, invalid message format'
    } else {
      logMsg = 'rejecting message, invalid signature'
    }

    if (!clientId) {
      err.code = 400
      throw err
    }

    yield this.delivery.reject({
      clientId,
      message: processed,
      error: err
    })

    return
  }

  debug('unexpected error in pre-processing inbound message:', err.stack)
  throw err
})

proto.onDisconnected = function ({ clientId }) {
  return this.auth.updatePresence({ clientId, connected: false })
}

proto.onConnected = function ({ clientId }) {
  return this.auth.updatePresence({ clientId, connected: true })
}

proto.onPreAuth = function (...args) {
  return this.auth.getTemporaryIdentity(...args)
}

proto.onSentChallengeResponse = co(function* (response) {
  const time = Date.now()
  const session = yield this.auth.handleChallengeResponse(response)
  return {
    time,
    position: session.serverPosition
  }
})

// proto.onRestoreRequest = co(function* ({ clientId, gt, lt }) {
//   let session
//   try {
//     session = yield this.auth.getMostRecentSessionByClientId(clientId)
//   } catch (err) {}

//   if (!session) {
//     debug(`ignoring "restore" request from outdated session: ${clientId}`)
//     return
//   }

//   yield this.delivery.deliverMessages({
//     clientId: session.clientId,
//     recipient: session.permalink,
//     gt,
//     lt
//   })
// })

proto.getProviderIdentity = co(function* () {
  const { object } = yield this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
  return omitVirtual(object)
})

proto.onGetInfo = co(function* () {
  const conf = yield this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.info)
  conf.aws = true
  conf.iotTopicPrefix = this.env.IOT_TOPIC_PREFIX
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
