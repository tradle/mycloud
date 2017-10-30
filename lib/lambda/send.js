process.env.LAMBDA_BIRTH_DATE = Date.now()

const wrap = require('../wrap')
const { bot } = require('../../samplebot')
exports.handler = wrap(function* (event, context) {
  yield bot.send(event)
})
