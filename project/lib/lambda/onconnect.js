const debug = require('debug')('tradle:sls:λ:connect')
const wrap = require('../wrap')
const { prettify } = require('../utils')
const { onEnter } = require('../user')

exports.handler = wrap.generator(function* (event, context) {
  debug('client connected', prettify(event))
  const clientId = 'someclientid'
  // yield onEnter({ clientId })
})
