const debug = require('debug')('tradle:sls:replicator')
const wrap = require('./wrap')
const Events = require('./events')
const { prettify } = require('./string-utils')
const { unmarshalDBItem } = require('./db-utils')

module.exports = {
  toEvents
}

function toEvents (mapper) {
  return wrap.generator(function* (event, context) {
    // unmarshalling is prob a waste of time
    const items = event.Records
      .map(record => record.dynamodb.NewImage)
      .filter(image => image)
      .map(unmarshalDBItem)
      .map(mapper)

    yield Events.putEvents(items)
  })
}
