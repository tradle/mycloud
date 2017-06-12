const debug = require('debug')('tradle:sls:λ:hooker')
const wrap = require('../wrap')
const { unmarshalDBItem } = require('../db-utils')
const { callWebhooks } = require('../provider')
const { parseCursorRecords } = require('../cursors')

exports.handler = wrap.generator(function* (event, context) {
  let parsed
  try {
    parsed = parseCursorRecords(event.Records)
  } catch (err) {
    debug('failed to parse cursor records')
    return
  }

  yield callWebhooks(parsed)
})
