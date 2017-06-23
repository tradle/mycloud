const debug = require('debug')('λ:samplebot')
const createBot = require('../../bot')
const { co } = require('../../utils')
const { prettify } = require('../../string-utils')
const bot = createBot()
const { TYPE } = bot.constants
const send = function (user, object) {
  return bot.send({ to: user.id, object })
}

bot.users.on('create', function oncreate (user) {
  send(user, 'Nice to meet you!')
})

exports.onmessage = bot.onmessage(co(function* ({ user, wrapper }) {
  debug('user', prettify(user))
  debug('wrapper', prettify(wrapper))
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

exports.onreadseal = bot.onreadseal(co(function* (seal) {
  debug('[START]', Date.now(), 'read seal:', JSON.stringify(seal))
}))

exports.onwroteseal = bot.onwroteseal(co(function* (seal) {
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
