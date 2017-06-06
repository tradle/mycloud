const debug = require('debug')('tradle:sls:user')
const { co, prettify } = require('./utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const Messages = require('./messages')
const { createReceiveMessageEvent } = require('./author')

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
  yield createReceiveMessageEvent({ message })
})

const onPreAuth = Auth.getTemporaryIdentity
const onSentChallengeResponse = Auth.handleChallengeResponse

module.exports = {
  onSentChallengeResponse,
  onPreAuth,
  onSubscribed,
  onSentMessage
}
