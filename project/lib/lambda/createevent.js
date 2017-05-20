process.env.CF_EventsTable = 'EventsTable'
require('../env')
const wrap = require('../wrap')
const { putEvent } = require('../events')
const { extend } = require('../utils')

exports.handler = wrap.generator(function* (event, context) {
  yield putEvent(event)
})
