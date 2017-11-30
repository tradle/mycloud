import '../init-lambda'

const { wrap, seals, debug } = require('../').tradle
exports.handler = wrap(function () {
  debug('[START]', Date.now())
  return seals.sealPending()
})
