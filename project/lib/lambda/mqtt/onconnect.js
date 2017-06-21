const debug = require('debug')('λ:onconnect')
const wrap = require('../../wrap')
const { onConnected } = require('../../user')
const { prettify } = require('../../string-utils')

exports.handler = wrap.generator(function* (event, context) {
  debug('client connected', prettify(event))
  const { clientId } = event
  yield onConnected({ clientId })
})
