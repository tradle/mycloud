const debug = require('debug')('tradle:sls:λ:preprocess')
const wrap = require('../wrap')
const { preProcessInbound } = require('../messages')
const { createReceiveMessageEvent } = require('../author')

exports.handler = wrap.generator(function* (event, context) {
  debug('prereceive')
  const message = yield preProcessInbound(event)
  yield createReceiveMessageEvent({ message })
  debug('preceived')
})
