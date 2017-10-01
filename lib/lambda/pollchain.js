const debug = require('debug')('λ:pollchain')
const { wrap, seals } = require('../')
exports.handler = wrap(function (event, context) {
  debug('[START]', Date.now())
  return seals.syncUnconfirmed()
})
