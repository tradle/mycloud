const debug = require('debug')('tradle:sls:λ:queuereceive')
const wrap = require('../wrap')
const { onSentMessage } = require('../user')
const { createReceiveMessageEvent } = require('../author')
const { prettify } = require('../utils')

exports.handler = wrap.generator(function* (event, context) {
  debug('prereceive', prettify(event))
  yield onSentMessage(event)
  debug('preceived')
})
