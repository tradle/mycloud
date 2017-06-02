const microtime = require('microtime')
const wrap = require('../wrap')
const { unmarshalDBItem } = require('../db-utils')
const { loadMessage } = require('../author')

exports.handler = wrap.generator(function* (event, context) {
  const items = event.Records.map(record => unmarshalDBItem(record.dynamodb.NewImage))
  return yield Promise.all(items.map(({ data }) => loadMessage(data)))

  // const now = microtime.nowStruct().join('')
  // console.log(items.map(({ id }) => {
  //   const start = +id
  //   const end = microtime.now()
  //   console.log('TIME', (end - start) / 1e6)
  // }))

  // console.log('STUB: receive', event)
  // cb()
})

function now () {
  const [s, m] = microtime.nowStruct()
  return s * 1e6 + m
}
