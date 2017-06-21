const debug = require('debug')('λ:sealpending')
const wrap = require('../../wrap')
const { sealPending } = require('../../seals')
const tradle = require('../../tradle')
const { seals } = tradle

exports.handler = wrap.promiser(function () {
  debug('[START]', Date.now())
  return seals.sealPending()
})
