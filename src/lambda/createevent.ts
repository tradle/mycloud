process.env.LAMBDA_BIRTH_DATE = Date.now()

const { wrap, events } = require('../').tradle
const { putEvent } = require('../events')

exports.handler = wrap(function* (event, context) {
  yield putEvent(event)
})
