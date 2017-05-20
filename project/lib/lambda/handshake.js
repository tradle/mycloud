
const { iot } = require('../aws')
const wrap = require('../wrap')

exports.shake = wrap.generator(function* (event, context) {
  console.log(event)
})
