const debug = require('debug')('λ:inbound')
const wrap = require('../../wrap')
const { getInbound } = require('../../messages')
const { timestamp } = require('../../utils')

exports.handler = wrap.promiser(function* (event, context) {
  debug('[START]', timestamp)
  const { gt, lt } = event.data
  return getInbound({ gt, lt })
})
