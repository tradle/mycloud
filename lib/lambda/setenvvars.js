const { discovery, env, wrap, debug } = require('../')
exports.handler = wrap((event, context) => {
  debug('mapping services')
  return discovery.discoverServices()
})
