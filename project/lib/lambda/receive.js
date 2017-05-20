const microtime = require('microtime')
const { unmarshalItem } = require('dynamodb-marshaler')

exports.handler = function (event, context, cb) {
  const items = event.Records.map(record => unmarshalItem(record.dynamodb.NewImage))
  const now = microtime.nowStruct().join('')
  console.log(items.map(({ id }) => {
    const start = +id
    const end = microtime.now()
    console.log('TIME', (end - start) / 1e6)
  }))

  // console.log('STUB: receive', event)
  cb()
}

function now () {
  const [s, m] = microtime.nowStruct()
  return s * 1e6 + m
}
