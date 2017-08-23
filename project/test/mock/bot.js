const co = require('co').wrap
const createBot = require('../../lib/bot')
const fakeTradle = require('./tradle')
const fakeUsers = require('./users')
const promiseNoop = co(function* () {})
const defaultUserModel = {
  id: 'tradle.User',
  type: 'tradle.Model',
  title: 'User',
  properties: {
    id: {
      type: 'string'
    }
  }
}

module.exports = fakeBot

function fakeBot (opts={}) {
  let {
    send=promiseNoop,
    objects={},
    identities={},
    messages={},
    userModel=defaultUserModel
  } = opts

  const tradle = opts.tradle || fakeTradle(opts)
  const models = {}
  const inputs = fakeBot.inputs({ userModel, models, tradle })
  const bot = createBot(inputs)
  return bot
}

fakeBot.inputs = createBot.inputs
fakeBot.fromEngine = opts => fakeBot(fakeBot.inputs(opts))
fakeBot.userModel = defaultUserModel
