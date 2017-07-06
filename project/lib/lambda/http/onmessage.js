const debug = require('debug')('λ:onmessage_http')
const { utils } = require('@tradle/engine')
const wrap = require('../../wrap')
const user = require('../../user')
const { prettify } = require('../../string-utils')
const { SEQ } = require('../../constants')
const { timestamp } = require('../../utils')
const Errors = require('../../errors')

exports.handler = wrap(function* (event, context) {
  debug('[START]', timestamp())
  // const message = new Buffer(JSON.parse(event.body), 'base64')
  const message = JSON.parse(event.body)
  // the user sent us a message
  yield user.onSentMessage({ message })
  debug('preceived')
}, {
  type: 'http'
})
