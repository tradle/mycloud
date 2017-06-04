const wrap = require('../wrap')
const { deletePresence } = require('../auth')
const { prettify } = require('../utils')

exports.handler = wrap.generator(function* (event, context) {
  console.log('client connected', prettify(event))

  const clientId = 'someclientid'
  yield deletePresence({ clientId })
})
