const { unmarshalItem } = require('dynamodb-marshaler')
const { prettify } = require('../utils')

exports.handler = function (event, context, cb) {
  console.log('env', process.env)
  if (event.Records) {
    const records = event.Records.map(record => unmarshalItem(record.dynamodb.NewImage))
    console.log(prettify(records))
  } else {
    console.log('event', prettify(event))
  }

  cb(null, event)
}
