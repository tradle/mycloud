const { debug, wrap, user, stringUtils, utils, constants } = require('../..')
const { prettify } = stringUtils
const { SEQ } = constants
const { timestamp } = utils
exports.handler = wrap(function* (event, context) {
  // the user sent us a message
  debug('[START]', timestamp())
  const { clientId, data } = event
  const message = new Buffer(data.data, 'base64')
  yield user.onSentMessage({ clientId, message })
  debug('preceived')
})
