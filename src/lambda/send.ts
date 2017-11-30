import '../init-lambda'

const bot = require('../bot').createBot()
exports.handler = bot.createHandler(function* (event, context) {
  yield bot.send(event)
})
