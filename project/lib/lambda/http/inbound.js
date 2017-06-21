const microtime = require('microtime')
const debug = require('debug')('λ:inbound')
const wrap = require('../../wrap')
const { getInbound } = require('../../messages')

exports.handler = wrap.promiser(function* (event, context) {
  debug('[START]', microtime.now())
  const { gt, lt } = event.data
  return getInbound({ gt, lt })
})
