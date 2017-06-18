const debug = require('debug')('tradle:sls:λ:pollchain')
const wrap = require('../../wrap')
const { sync } = require('../../blockchain')

exports.handler = wrap.promiser(function* (event, context) {
  debug('[START]', Date.now())
  return sync()
})
