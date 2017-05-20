const debug = require('debug')('tradle:sls:λ:deliver')
const wrap = require('../wrap')
const { deliverMessage } = require('../delivery')
const microtime = require('microtime')

/**
 * deliver a signed message to a client
 */
exports.handler = wrap.generator(function* (event, context) {
  event.dateProcessed = microtime.nowStruct().join('')
  yield deliverMessage(event)
})
