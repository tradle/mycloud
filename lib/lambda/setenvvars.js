// NOT USED AT THE MOMENT

const { discovery, env, wrap, debug } = require('../').tradle
exports.handler = wrap((event, context) => {
  debug('mapping services')
  return discovery.discoverServices()
})
