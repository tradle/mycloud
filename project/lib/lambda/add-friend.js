
const wrap = require('../wrap')
const Friends = require('../friends')
// const { getRecordsFromEvent } = require('../db-utils')

exports.handler = wrap(function* (event) {
  // const friends = getRecordsFromEvent(event)
  // yield friends.map(Friends.load)

  const { name, url } = event
  if (!(name && url)) {
    throw new Error('"name" and "url" are required')
  }

  return yield Friends.load({ name, url })
})
