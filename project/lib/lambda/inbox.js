const debug = require('debug')('λ:inbox')
const wrap = require('../wrap')
const Iot = require('../iot-utils')
const { getInbound } = require('../messages')
const { timestamp } = require('../utils')

exports.handler = wrap.generator(function* (event, context) {
  debug('[START]', timestamp)
  const { gt, lt } = event.data
  const messages = yield getInbound({ gt, lt })
  yield Iot.publish({
    topic: 'messages/inbound',
    payload: messages
  })
})
