const microtime = require('microtime')
// const { unmarshalItem } = require('../db-utils')

exports.handler = function (items, context, cb) {
  const now = microtime.nowStruct().join('')
  items.forEach(({ id }) => {
    const start = +id
    const end = microtime.now()
    console.log('start', start, 'end', end, 'time', (end - start) / 1e6)
  })

  // console.log('STUB: receive', event)
  cb()
}
