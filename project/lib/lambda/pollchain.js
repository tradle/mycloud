const debug = require('debug')('λ:pollchain')
const wrap = require('../wrap')
const { seals } = require('../')

exports.handler = wrap.promiser(function (event, context) {
  debug('[START]', Date.now())
  return seals.syncUnconfirmed()
})
