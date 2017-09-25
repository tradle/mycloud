const debug = require('debug')('λ:setenv')
const { discovery, env, wrap } = require('../')

exports.handler = wrap.plain(function* (event, context) {
  debug('mapping services')
  yield discovery.discoverServices()
  return {
    IOT_ENDPOINT: env.IOT_ENDPOINT
  }
})

