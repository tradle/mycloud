import '../init-lambda'

const { tradle, bot } = require('../samplebot')
const { wrap } = tradle
exports.handler = wrap(function* (event, context) {
  yield bot.seal(event)
})
