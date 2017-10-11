const { debug, wrap, user } = require('../..')
exports.handler = wrap(function* (event, context) {
  const { clientId, topics } = event
  yield user.onSubscribed({ clientId, topics })
})
