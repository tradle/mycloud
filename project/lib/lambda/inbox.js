const microtime = require('microtime')
const debug = require('debug')('tradle:sls:λ:inbox')
const wrap = require('../wrap')
const Iot = require('../iot-utils')
// const { prettify } = require('../utils')
const { getInbound } = require('../messages')

exports.handler = wrap.generator(function* (event, context) {
  debug('[START]', microtime.now())
  const { gt, lt } = event.data
  const messages = yield getInbound({ gt, lt })
  yield Iot.publish({
    topic: 'messages/inbound',
    payload: messages
  })
})
