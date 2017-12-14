const { co, omitVirtual, bindAll, RESOLVED_PROMISE } = require('./utils')
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
  logger,
  auth,
  iot,
  provider,
  delivery,
  buckets,
  messages,
  lambdaUtils,
  tasks
}) {
  bindAll(this)

  this.env = env
  this.logger = logger.sub('usersim')
  this.auth = auth
  this.iot = iot
  this.provider = provider
  this.delivery = delivery
  this.buckets = buckets
  this.messages = messages
  this.lambdaUtils = lambdaUtils
  this.tasks = tasks
}

const proto = UserSim.prototype

proto.onSubscribed = co(function* ({ clientId, topics }) {
  this.logger.debug('client subscribed to topics:', topics.join(', '))
  // yield onEnter({ clientId })

  // if (Math.random() < 0.5) {
  //   console.log('ONSUBSCRIBED, REQUESTING RECONNECT')
  //   yield this.requestIotClientReconnect({ clientId })
  //   return
  // }

  if (!this.delivery.mqtt.includesClientMessagesTopic({ clientId, topics })) {
    this.logger.debug('message topic not found in topics array')
    return
  }

  let session
  try {
    session = yield this.auth.setSubscribed({ clientId, subscribed: true })
    this.logger.debug(`client subscribed`, session)
  } catch (error) {
    this.logger.error('failed to update presence information', error)
    yield this.requestIotClientReconnect({ clientId, error })
    Errors.rethrow(error, 'system')
    return
  }

  const { permalink, clientPosition, serverPosition } = session
  const after = (clientPosition.received && clientPosition.received.time) || 0
  this.logger.debug(`delivering messages after time ${after}`)
  try {
    yield this.delivery.deliverMessages({
      session,
      recipient: permalink,
      range: { after }
    })
  } catch (error) {
    this.logger.error('live delivery failed', error)
    yield this.requestIotClientReconnect({ clientId, error })
    Errors.rethrow(error, 'system')
  }
})

// const onSentMessageOverMQTT = co(function* ({ clientId, message }) {
//   try {
//     yield onSentMessage({ message })
//   } catch (err) {}
// })

proto.onSentMessage = co(function* ({ clientId, message }) {
  const { TESTING } = this.env

  // if (Math.random() < 0.5) {
  //   console.log('ONSENTMESSAGE, REQUESTING RECONNECT')
  //   yield this.requestIotClientReconnect({ clientId })
  //   return
  // }

  let ensureLiveSession = RESOLVED_PROMISE
  if (clientId) {
    ensureLiveSession = this.tasks.add(this.ensureLiveSession({ clientId }))
  }

  let err
  let processed
  try {
    processed = yield this.provider.receiveMessage({ message })
  } catch (e) {
    // delivery http
    err = e
    if (!clientId) {
      Errors.ignore(err, Errors.Duplicate)
      return
    }
  }

  if (processed) {
    // SUCCESS!
    this.logger.debug('received valid message from user')

    this.tasks.add({
      name: 'delivery:ack',
      promiser: async () => {
        await ensureLiveSession
        await this.delivery.ack({
          clientId,
          message: processed
        })
      }
    })

    const {
      BOT_ONMESSAGE,
      INVOKE_BOT_LAMBDAS_DIRECTLY=TESTING
    } = this.env

    if (!BOT_ONMESSAGE) {
      this.logger.warn('no bot subscribed to "onmessage"')
      return
    }

    // const { author, time, link } = wrapper.message
    const arg = INVOKE_BOT_LAMBDAS_DIRECTLY ? processed : this.messages.stripData(processed)
    this.logger.debug(`passing message from ${processed._author} on to bot`)
    const resp = yield this.lambdaUtils.invoke({
      sync: true,
      local: INVOKE_BOT_LAMBDAS_DIRECTLY,
      name: BOT_ONMESSAGE,
      arg
      // arg: JSON.stringify({ author, time, link })
    })

    this.logger.debug(`${BOT_ONMESSAGE} finished processing`)
    return TESTING ? resp : processed
  }

  this.logger.debug(`processing error in receive: ${err.name}`)
  processed = err.progress
  if (err instanceof Errors.Duplicate) {
    this.logger.info('ignoring but acking duplicate message', {
      link: processed._link,
      author: processed._author
    })

    // HTTP
    if (!clientId) return

    this.tasks.add({
      name: 'delivery:ack',
      promiser: async () => {
        await ensureLiveSession
        await this.delivery.ack({
          clientId,
          message: processed
        })
      }
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

    this.logger.warn(logMsg, {
      message: processed,
      error: err.stack
    })

    if (!clientId) {
      err.code = 400
      throw err
    }

    this.tasks.add({
      name: 'delivery:reject',
      promiser: async () => {
        await ensureLiveSession
        await this.delivery.reject({
          clientId,
          message: processed,
          error: err
        })
      }
    })

    return
  }

  this.logger.error('unexpected error in pre-processing inbound message', {
    message: processed || message,
    error: err.stack
  })

  throw err
})

proto.onDisconnected = co(function* ({ clientId }) {
  try {
    const session = yield this.auth.setConnected({ clientId, connected: false })
    this.logger.debug(`client disconnected`, session)
  } catch (error) {
    this.logger.error('failed to update presence information', error)
    yield this.requestIotClientReconnect({ clientId, error })
    Errors.rethrow(error, 'system')
  }
})

proto.ensureLiveSession = async function ensureLiveSession ({ clientId }) {
  try {
    await this.auth.getMostRecentSessionByClientId(clientId)
  } catch (error) {
    Errors.ignore(error, Errors.NotFound)
    this.logger.debug('iot session not found', { clientId })
    await this.requestIotClientReconnect({ clientId, error })
  }
}

proto.onConnected = co(function* ({ clientId }) {
  // if (Math.random() < 0.5) {
  //   console.log('ONCONNECTED, REQUESTING RECONNECT')
  //   yield this.requestIotClientReconnect({ clientId })
  //   return
  // }

  try {
    const session = yield this.auth.setConnected({ clientId, connected: true })
    this.logger.debug(`client connected`, session)
  } catch (error) {
    this.logger.error('failed to update presence information', error)
    yield this.requestIotClientReconnect({ clientId, error })
    Errors.rethrow(error, 'system')
  }
})

proto.requestIotClientReconnect = function ({ clientId, error, message='please reconnect' }) {
  this.logger.debug('requesting iot client reconnect', error && {
    stack: error.stack
  })

  return this.delivery.mqtt.trigger({
    clientId,
    topic: 'error',
    payload: {
      message
    }
  })
}

proto.onPreAuth = function (...args) {
  return this.auth.createTemporaryIdentity(...args)
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
//     this.debug(`ignoring "restore" request from outdated session: ${clientId}`)
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

// proto.onGetInfo = co(function* () {
//   const conf = yield this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.info)
//   conf.aws = true
//   conf.iotParentTopic = this.env.IOT_PARENT_TOPIC
//   // conf.iotTopicPrefix = this.env.IOT_TOPIC_PREFIX
//   return conf
// })

//   return yield {
//     style: getProviderStyle(),
//     identity: getProviderIdentity(),
//     authEndpoint: `https://${event.headers.Host}/${SERVERLESS_STAGE}/tradle`
//   }
// })

// function getProviderStyle () {
//   return Buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.style)
//     .catch(err => {
//       this.debug('no styles found', err)
//       return {}
//     })
// }
