const debug = require('debug')('λ:sealpending')
const { wrap, seals } = require('../')
exports.handler = wrap(function () {
  debug('[START]', Date.now())
  return seals.sealPending()
})
