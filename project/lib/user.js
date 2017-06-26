const debug = require('debug')('tradle:sls:user')
const { co, getLink, typeforce } = require('./utils')
const { prettify } = require('./string-utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const Messages = require('./messages')
const { createReceiveMessageEvent } = require('./provider')
const Iot = require('./iot-utils')
const { invoke } = require('./lambda-utils')
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants')
const { PublicConfBucket } = require('./buckets')
const { SERVERLESS_STAGE, BOT_ONMESSAGE } = require('./env')
const Errors = require('./errors')
const types = require('./types')

const onSubscribed = co(function* ({ clientId, topics }) {
  debug('client subscribed to topics:', topics.join(', '))
  // yield onEnter({ clientId })

  const messagesTopic = Iot.getMessagesTopicForClient(clientId)
  const catchAll = new RegExp(`${clientId}/[+#]{1}`)
  const subscribedToMessages = topics.find(topic => {
    return topic === messagesTopic || catchAll.test(topic)
  })

  if (!subscribedToMessages) return

  const session = yield Auth.getSession({ clientId })
  debug('retrieved session', prettify(session))
  const { permalink, clientPosition, serverPosition } = session
  const gt = (clientPosition.received && clientPosition.received.time) || 0
  yield Delivery.deliverMessages({ clientId, permalink, gt })
})

const onSentMessage = co(function* ({ clientId, message }) {
  // can probably move this to lamdba
  // as it's normalizing transport-mangled inputs
  message = Messages.normalizeInbound(message)
  try {
    message = yield Messages.preProcessInbound(message)
  } catch (err) {
    if (err instanceof Errors.InvalidMessageFormat) {
      yield Delivery.reject({
        clientId,
        message: { object: message },
        reason: Errors.export(err)
      })

      return
    }

    debug('unexpected error in pre-processing inbound message:', err.stack)
    throw err
  }

  let wrapper
  try {
    wrapper = yield createReceiveMessageEvent({ message })
  } catch (err) {
    wrapper = { object: message }
    if (err instanceof Errors.Duplicate) {
      debug('ignoring but acking duplicate message', prettify(wrapper))
      yield Delivery.ack({
        clientId,
        message: wrapper
      })

      return
    }

    if (err instanceof Errors.TimeTravel) {
      debug('rejecting message with lower timestamp than previous')
      yield Delivery.reject({
        clientId,
        message: wrapper,
        error: err
      })

      return
    }

    debug('unexpected error in processing inbound message:', err.stack)
    throw err
  }

  yield Delivery.ack({
    clientId,
    message: wrapper.message
  })

  if (!BOT_ONMESSAGE) {
    debug('no bot subscribed to "onmessage"')
    return
  }

  const { author, time, link } = wrapper.message
  yield invoke({
    name: BOT_ONMESSAGE,
    arg: JSON.stringify({ author, time, link })
  })

  // yield Iot.publish({
  //   topic: 'message/preprocessed',
  //   payload: {
  //     author: wrapper.message.author,
  //     seq: wrapper.message.object[SEQ]
  //   }
  // })
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

const getProviderIdentity = () => {
  return PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.identity)
    .then(({ object }) => object)
}

const onGetInfo = co(function* (event) {
  return PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.info)
  // return yield {
  //   style: getProviderStyle(),
  //   identity: getProviderIdentity(),
  //   authEndpoint: `https://${event.headers.Host}/${SERVERLESS_STAGE}/tradle`
  // }
})

function getProviderStyle () {
  return PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.style)
    .catch(err => {
      debug('no styles found')
      return {}
    })
}

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
