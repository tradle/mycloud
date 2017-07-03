const co = require('co').wrap
const createBot = require('../../lib/bot')
const fakeTradle = require('./tradle')
const fakeUsers = require('./users')
const promiseNoop = co(function* () {})

module.exports = function fakeBot (opts={}) {
  const {
    send=promiseNoop,
    objects={},
    identities={},
    messages={}
  } = opts

  const {
    tradle=fakeTradle({ objects, messages, identities, send })
  } = opts

  const users = {}
  const bot = createBot({
    users: fakeUsers({
      users,
      oncreate: user => bot.call('onusercreate', user)
    }),
    tradle
  })

  return bot
}
