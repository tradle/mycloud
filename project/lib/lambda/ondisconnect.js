const wrap = require('../wrap')
const { prettify, randomString } = require('../utils')
const { docClient } = require('../aws')
const { PresenceTable } = require('../env')
const { deletePresence } = require('../presence')

exports.handler = wrap.generator(function* (event, context) {
  console.log('client connected', prettify(event))

  const clientId = 'someclientid'
  yield deletePresence({ clientId })
})
