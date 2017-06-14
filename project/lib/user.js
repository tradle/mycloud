const debug = require('debug')('tradle:sls:user')
const { co, prettify } = require('./utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const Messages = require('./messages')
const { createReceiveMessageEvent } = require('./provider')
const Iot = require('./iot-utils')
const { invoke } = require('./lambda-utils')
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants')
const { PublicConfBucket } = require('./buckets')
const { SERVERLESS_STAGE, BOT_LAMBDA } = require('./env')

// const onConnect = co(function* ({ clientId }) {
//   const { clientId, permalink, tip } = Auth.getSession({ clientId })
//   yield Delivery.deliverMessages({ clientId, permalink, gt: tip })
// })

const onSubscribed = co(function* ({ clientId }) {
  const session = yield Auth.getSession({ clientId })
  debug('retrieved session', prettify(session))
  const { permalink, tip } = session
  yield Delivery.deliverMessages({ clientId, permalink, gt: tip })
})

const onSentMessage = co(function* (event) {
  const message = yield Messages.preProcessInbound(event)
  const wrapper = yield createReceiveMessageEvent({ message })
  const { author, seq } = wrapper.message
  yield invoke({
    name: BOT_LAMBDA,
    arg: JSON.stringify({ author, seq })
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
const onSentChallengeResponse = Auth.handleChallengeResponse
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

const onGetInfo = co(function* (event) {
  const identity = PublicConfBucket.get(PUBLIC_CONF_BUCKET.identity)
    .then(({ object }) => object)

  return yield {
    styles: PublicConfBucket.get(PUBLIC_CONF_BUCKET.styles),
    identity: identity,
    authEndpoint: `${event.headers.Host}/${SERVERLESS_STAGE}/tradle`
  }
})

module.exports = {
  onSentChallengeResponse,
  onPreAuth,
  onSubscribed,
  onSentMessage,
  onRestoreRequest,
  onGetInfo
}
