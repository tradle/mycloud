process.env.LAMBDA_BIRTH_DATE = Date.now()

import { tradle, wrap } from '../'

const { events } = tradle
exports.handler = wrap(function* (event, context) {
  const results = events.fromStreamEvent(event)
  if (results.length) {
    yield events.putEvents(results)
  }
}, { source: 'dynamodbstreams' })
