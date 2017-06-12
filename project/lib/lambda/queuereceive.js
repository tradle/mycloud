const debug = require('debug')('tradle:sls:λ:queuereceive')
const wrap = require('../wrap')
const { onSentMessage } = require('../user')
const { createReceiveMessageEvent } = require('../provider')
const { prettify } = require('../utils')

exports.handler = wrap.generator(function* (event, context) {
  debug('prereceive [START]', Date.now(), prettify(event))
  // the user sent us a message
  yield onSentMessage(event)
  debug('preceived')
})
