const debug = require('debug')('tradle:sls:λ:echobot')
const omit = require('object.omit')
const bot = require('../bot-engine')
const { co } = require('../utils')

exports.handler = bot.onmessage(co(function* ({ message, payload }) {
  debug('[START]', Date.now(), 'message:', JSON.stringify(message))
  // yield bot.send({
  //   recipient: message.author,
  //   object: payload.object
  // })

  yield bot.send({
    to: message.author,
    object: {
      _t: 'tradle.SimpleMessage',
      message: payload.object.message
    }
  })

  yield bot.seal({
    link: payload.link
  })
}))
