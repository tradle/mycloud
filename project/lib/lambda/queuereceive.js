const microtime = require('microtime')
const debug = require('debug')('tradle:sls:λ:queuereceive')
const wrap = require('../wrap')
const user = require('../user')
const { createReceiveMessageEvent } = require('../provider')
const { prettify } = require('../utils')
const { SEQ } = require('../constants')

exports.handler = wrap.generator(function* (event, context) {
  debug('[START]', microtime.now(), prettify(event))
  // the user sent us a message
  yield user.onSentMessage(event)
  debug('preceived')
})
