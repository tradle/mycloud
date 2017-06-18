const wrap = require('../wrap')
const bot = require('../bot-engine')

exports.handler = wrap.generator(function* (event, context) {
  yield bot.send(event)
})
