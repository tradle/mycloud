const { debug, wrap, user } = require('../..').tradle
exports.handler = wrap(function* (event, context) {
  const { clientId, topics } = event
  yield user.onSubscribed({ clientId, topics })
})
