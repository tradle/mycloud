const debug = require('debug')('tradle:sls:bot-engine')
const wrap = require('./wrap')
const Events = require('./events')
const { unmarshalDBItem } = require('./db-utils')

module.exports = {
  toEvents
}

function toEvents (mapper) {
  return wrap.generator(function* (event, context) {
    // unmarshalling is prob a waste of time
    const items = event.Records
      .map(record => unmarshalDBItem(record.dynamodb.NewImage))
      .map(mapper)

    yield Events.putEvents(items)
  })
}
