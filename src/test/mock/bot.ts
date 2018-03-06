import { createBot } from '../../bot'
import fakeTradle from './tradle'
import fakeUsers from './users'

const promiseNoop = async () => {}
// const defaultUserModel = {
//   id: 'tradle.User',
//   type: 'tradle.Model',
//   title: 'User',
//   properties: {
//   }
// }

function fakeBot (opts:any={}) {
  let {
    send=promiseNoop,
    objects={},
    identities={},
    messages={},
  } = opts

  const tradle = opts.tradle || fakeTradle(opts)
  const models = {}
  const inputs = fakeBot.inputs({ models, tradle })
  inputs.users = fakeUsers({
    oncreate: user => bot.trigger('usercreate', user)
  })

  const bot = createBot(inputs)
  return bot
}

fakeBot.inputs = createBot.inputs
fakeBot.fromEngine = opts => fakeBot(fakeBot.inputs(opts))

export = fakeBot
