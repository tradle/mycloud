const debug = require('debug')('λ:samplebot')
const keepModelsFresh = require('@tradle/bot-require-models')
const createBot = require('../lib/bot')
const tradle = require('../')
const co = tradle.utils.loudCo
const { TYPE } = tradle.constants
const bot = createBot()
const send = function (user, object) {
  return bot.send({ to: user.id, object })
}

module.exports = bot.exports

// bot.use(keepModelsFresh())

bot.onusercreate(function oncreate (user) {
  send(user, 'Nice to meet you!')
})

bot.onuseronline(function onUserOnline (user) {
  send(user, `you're online!`)
})

bot.onmessage(co(function* ({ user, wrapper }) {
  const { payload } = wrapper
  const { object } = payload
  const type = object[TYPE]
  switch (type) {
  case 'tradle.SelfIntroduction':
  case 'tradle.IdentityPublishRequest':
    if (!object.profile) break

    let name = object.profile.firstName
    let oldName = user.profile && user.profile.firstName
    user.profile = object.profile
    yield bot.users.save(user)
    if (name !== oldName) {
      yield send(user, `${name}, eh? Hot name!`)
    }

    break
  case 'tradle.SimpleMessage':
    yield send(user, `tell me more about this "${object.message}," it sounds interesting`)
    break
  case 'tradle.CustomerWaiting':
    yield send(user, 'Buahahaha! ...I mean welcome to my super safe world')
    break
  default:
    yield send(user, `Huh? What's a ${type}? I only understand simple messages. One day, when I'm a real boy...`)
    break
  }
}))

bot.onreadseal(co(function* (seal) {
  debug('[START]', Date.now(), 'read seal:', JSON.stringify(seal))
}))

bot.onwroteseal(co(function* (seal) {
  debug('[START]', Date.now(), 'wrote seal:', JSON.stringify(seal))
}))

// exports.onmessage = bot.onmessage(co(function* ({ user, wrapper }) {
//   const { message, payload } = wrapper
//   debug('[START]', Date.now(), 'message:', JSON.stringify(message))
//   // yield bot.send({
//   //   recipient: message.author,
//   //   object: payload.object
//   // })

//   yield bot.send({
//     to: user.id,
//     object: {
//       _t: 'tradle.SimpleMessage',
//       message: payload.object.message
//     }
//   })

//   yield bot.seal({
//     link: payload.link
//   })
// }))
