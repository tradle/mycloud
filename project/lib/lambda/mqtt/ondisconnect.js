const debug = require('debug')('tradle:sls:λ:ondisconnect')
const wrap = require('../../wrap')
const { onDisconnected } = require('../../user')
const { prettify } = require('../../utils')

exports.handler = wrap.generator(function* (event, context) {
  debug('client disconnected', prettify(event))
  const { clientId } = event
  yield onDisconnected({ clientId })
})
