const { debug, wrap, user, stringUtils } = require('../..').tradle
const { onConnected } = user
const { prettify } = stringUtils
exports.handler = wrap(function* (event, context) {
  debug('client connected', prettify(event))
  const { clientId } = event
  yield onConnected({ clientId })
})
