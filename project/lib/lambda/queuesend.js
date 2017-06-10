const debug = require('debug')('tradle:sls:λ:send')
const wrap = require('../wrap')
const { createSendMessageEvent } = require('../provider')

/**
 * Enqueue a message for signing and sending
 */
exports.handler = wrap.generator(function* (event, context) {
  yield createSendMessageEvent(event)
})
