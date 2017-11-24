process.env.LAMBDA_BIRTH_DATE = Date.now()

const tradle = require('../').tradle
const { wrap, env } = tradle
// const { getRecordsFromEvent } = require('../db-utils')
exports.handler = wrap(function* (event) {
  // const friends = getRecordsFromEvent(event)
  // yield friends.map(Friends.load)
  const { url } = event
  if (!url) {
    throw new Error('"url" is required')
  }

  yield tradle.friends.load({ url })
  console.log('DONE LOADING FRIEND')
}, { source: 'lambda' })
