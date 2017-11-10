process.env.LAMBDA_BIRTH_DATE = Date.now()

const { getRecordsFromEvent } = require('../db-utils')
const { prettify } = require('../string-utils')
exports.handler = function (event, context, cb) {
  if (event.Records) {
    const records = getRecordsFromEvent(event)
    console.log(prettify(records))
  } else {
    console.log('event', prettify(event))
  }

  cb(null, event)
}
