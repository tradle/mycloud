import '../init-lambda'

const { wrap, events } = require('../').tradle
const { putEvent } = events

exports.handler = wrap(function* (event, context) {
  yield putEvent(event)
})
