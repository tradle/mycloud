const debug = require('debug')('λ:ondisconnect')
const wrap = require('../../wrap')
const { onDisconnected } = require('../../user')
const { prettify } = require('../../string-utils')

exports.handler = wrap(function* (event, context) {
  debug('client disconnected', prettify(event))
  const { clientId } = event
  yield onDisconnected({ clientId })
})
