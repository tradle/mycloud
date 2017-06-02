const wrap = require('../wrap')
const { prettify } = require('../utils')
const { onEnter } = require('../presence')

exports.handler = wrap.generator(function* (event, context) {
  console.log('client connected', prettify(event))
  const clientId = 'someclientid'
  yield onEnter({ clientId })
})
