const debug = require('debug')('tradle:sls:λ:outbox')
const wrap = require('../wrap')
const { prettify } = require('../utils')
const { onRestoreRequest } = require('../user')

exports.handler = wrap.generator(function* (event, context) {
  const { topic, data } = event
  const clientId = topic.split('/')[0]
  const { gt, lt } = data
  yield onRestoreRequest({ clientId, lt, gt })
})
