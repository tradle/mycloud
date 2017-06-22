const debug = require('debug')('λ:samplebot')
const createBot = require('../../bot')
const { co } = require('../../utils')

const bot = createBot()

exports.onreadseal = bot.onreadseal(co(function* (seal) {
  debug('[START]', Date.now(), 'read seal:', JSON.stringify(seal))
}))

exports.onwroteseal = bot.onwroteseal(co(function* (seal) {
  debug('[START]', Date.now(), 'wrote seal:', JSON.stringify(seal))
}))

exports.onmessage = bot.onmessage(co(function* ({ user, wrapper }) {
  const { message, payload } = wrapper
  debug('[START]', Date.now(), 'message:', JSON.stringify(message))
  // yield bot.send({
  //   recipient: message.author,
  //   object: payload.object
  // })

  yield bot.send({
    to: user.id,
    object: {
      _t: 'tradle.SimpleMessage',
      message: payload.object.message
    }
  })

  yield bot.seal({
    link: payload.link
  })
}))
