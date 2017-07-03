const wrap = require('../wrap')
const bot = require('../bot-engine')

exports.handler = wrap(function* (event, context) {
  yield bot.seal(event)
})
