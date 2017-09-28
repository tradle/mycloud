const { wrap, friends } = require('../')
// const { getRecordsFromEvent } = require('../db-utils')
exports.handler = wrap(function* (event) {
  // const friends = getRecordsFromEvent(event)
  // yield friends.map(Friends.load)
  const { url } = event
  if (!url) {
    throw new Error('"url" is required')
  }

  yield friends.load({ url })
  console.log('DONE LOADING FRIEND')
})
