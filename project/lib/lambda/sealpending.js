require('../../test/env')

const debug = require('debug')('λ:sealpending')
const wrap = require('../wrap')
const { seals } = require('../')

exports.handler = wrap(function () {
  debug('[START]', Date.now())
  return seals.sealPending()
})
