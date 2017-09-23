const debug = require('debug')('λ:onmessage_http')
const { wrap, user, stringUtils, utils } = require('../../')
const { prettify } = stringUtils
const { timestamp } = utils

exports.handler = wrap(function* (event, context) {
  debug('[START]', timestamp())
  // const message = new Buffer(JSON.parse(event.body), 'base64')
  const { message } = event.body
  // the user sent us a message
  yield user.onSentMessage({ message })
  debug('preceived')
}, {
  type: 'http'
})
