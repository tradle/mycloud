const debug = require('debug')('λ:sealpending')
const wrap = require('../wrap')
const { seals } = require('../')

exports.handler = wrap.promiser(function () {
  debug('[START]', Date.now())
  return seals.sealPending()
})
