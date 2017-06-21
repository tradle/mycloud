const debug = require('debug')('λ:outbox')
const wrap = require('../wrap')
const { prettify } = require('../string-utils')
const { onRestoreRequest } = require('../user')

exports.handler = wrap.generator(function* (event, context) {
  const { topic, data } = event
  const clientId = topic.split('/')[0]
  const { gt, lt } = data
  yield onRestoreRequest({ clientId, lt, gt })
})
