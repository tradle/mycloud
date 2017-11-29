process.env.LAMBDA_BIRTH_DATE = Date.now()

const bot = require('../bot').createBot()
exports.handler = bot.createHandler(function* (event, context) {
  yield bot.send(event)
})
