const debug = require('debug')('tradle:sls:replicator')
const { wrap, events } = require('./').tradle
const { prettify } = require('./string-utils')
const { getRecordsFromEvent } = require('./db-utils')

module.exports = {
  toEvents
}

function toEvents (mapper, oldAndNew) {
  return wrap(function* (event, context) {
    // unmarshalling is prob a waste of time
    const items = getRecordsFromEvent(event, oldAndNew)
      .map(mapper)
      .filter(notNull)

    yield events.putEvents(items)
  })
}

function notNull (val) {
  return val != null
}
