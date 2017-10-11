const { debug, wrap, seals } = require('../')
exports.handler = wrap(function (event, context) {
  debug('[START]', Date.now())
  return seals.syncUnconfirmed()
})
