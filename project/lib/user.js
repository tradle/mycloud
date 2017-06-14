const debug = require('debug')('tradle:sls:user')
const { co, prettify, getLink, typeforce } = require('./utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const Messages = require('./messages')
const { createReceiveMessageEvent } = require('./provider')
const Iot = require('./iot-utils')
const { invoke } = require('./lambda-utils')
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants')
const { PublicConfBucket } = require('./buckets')
const { SERVERLESS_STAGE, BOT_LAMBDA } = require('./env')
const Errors = require('./errors')
const types = require('./types')

// const onConnect = co(function* ({ clientId }) {
//   const { clientId, permalink, tip } = Auth.getSession({ clientId })
//   yield Delivery.deliverMessages({ clientId, permalink, gt: tip })
// })

const onSubscribed = co(function* ({ clientId }) {
  const session = yield Auth.getSession({ clientId })
  debug('retrieved session', prettify(session))
  const { permalink, clientPosition, serverPosition } = session
  const gt = clientPosition.received || 0
  yield Delivery.deliverMessages({ clientId, permalink, gt })
})

const sendAck = function sendAck ({ clientId, id }) {
  typeforce(types.messageId, id)

  return Iot.publish({
    topic: `${clientId}/ack`,
    payload: {
      message: id
    }
  })
}

const onSentMessage = co(function* ({ clientId, message }) {
  message = Messages.normalizeInbound(message)
  try {
    message = yield Messages.preProcessInbound(message)
  } catch (err) {
    if (err instanceof Errors.ClockDrift || err instanceof Errors.InvalidMessageFormat) {
      yield Iot.publish({
        topic: `${clientId}/reject`,
        payload: {
          message: Messages.getMessageId({ object: message }),
          reason: Errors.export(err)
        }
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
    if (err instanceof Errors.DuplicateMessage) {
      debug('ignoring duplicate message')
      yield sendAck({
        clientId,
        id: {
          time: message.time,
          link: err.link
        }
      })

      return
    }

    debug('unexpected error in processing inbound message:', err.stack)
    throw err
  }

  yield sendAck({
    clientId,
    id: Messages.getMessageId(wrapper.message)
  })

  const { author, time } = wrapper.message
  yield invoke({
    name: BOT_LAMBDA,
    arg: JSON.stringify({ author, time })
  })

  // yield Iot.publish({
  //   topic: 'message/preprocessed',
  //   payload: {
  //     author: wrapper.message.author,
  //     seq: wrapper.message.object[SEQ]
  //   }
  // })
})

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
  return yield {
    styles: getProviderStyles(),
    identity: getProviderIdentity(),
    authEndpoint: `https://${event.headers.Host}/${SERVERLESS_STAGE}/tradle`
  }
})

function getProviderStyles () {
  return PublicConfBucket.getJSON(PUBLIC_CONF_BUCKET.styles)
    .catch(err => {
      debug('no styles found')
      return {}
    })
}

module.exports = {
  onSentChallengeResponse,
  onPreAuth,
  onSubscribed,
  onSentMessage,
  onRestoreRequest,
  onGetInfo
}
