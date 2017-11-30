import '../../init-lambda'

const tradle = require('../..').tradle
const { debug, wrap, user, stringUtils } = tradle
const { onConnected } = user
const { prettify } = stringUtils
exports.handler = wrap(function* (event, context) {
  debug('client connected', event)
  const { clientId } = event
  yield onConnected({ clientId })
}, { source: 'iot' })
