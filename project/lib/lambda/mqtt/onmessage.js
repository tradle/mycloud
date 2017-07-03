const debug = require('debug')('λ:onmessage')
const wrap = require('../../wrap')
const user = require('../../user')
const { prettify } = require('../../string-utils')
const { SEQ } = require('../../constants')
const { timestamp } = require('../../utils')

exports.handler = wrap(function* (event, context) {
  debug('[START]', timestamp(), prettify(event))
  // the user sent us a message
  const { clientId, data } = event
  const message = new Buffer(data.data, 'base64')
  yield user.onSentMessage({ clientId, message })
  debug('preceived')
})
