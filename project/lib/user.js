const { co } = require('./utils')
const Auth = require('./auth')
const Delivery = require('./delivery')
const onChallengeResponse = co(function* (response) {
  return yield Auth.handleChallengeResponse(response)
})

// const onConnect = co(function* ({ clientId }) {
//   const { clientId, permalink, tip } = Auth.getSession({ clientId })
//   yield Delivery.deliverMessages({ clientId, recipient: permalink, gt: tip })
// })

const onSubscribe = co(function* ({ clientId }) {
  const { clientId, permalink, tip } = Auth.getSession({ clientId })
  yield Delivery.deliverMessages({ clientId, recipient: permalink, gt: tip })
})

module.exports = {
  onChallengeResponse,
  onRequestTemporaryIdentity: Auth.getTemporaryIdentity,
  onSubscribe
}
