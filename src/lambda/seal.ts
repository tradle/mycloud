process.env.LAMBDA_BIRTH_DATE = Date.now()

const { tradle, bot } = require('../samplebot')
const { wrap } = tradle
exports.handler = wrap(function* (event, context) {
  yield bot.seal(event)
})
