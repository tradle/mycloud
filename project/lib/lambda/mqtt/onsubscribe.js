const debug = require('debug')('tradle:sls:λ:subscribe')
const wrap = require('../../wrap')
const { prettify } = require('../../utils')
const { onSubscribed } = require('../../user')
const { getMessagesTopicForClient } = require('../../iot-utils')

exports.handler = wrap.generator(function* (event, context) {
  const { clientId, topics } = event
  yield onSubscribed({ clientId, topics })
})
