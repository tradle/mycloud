
import { createBot } from '../../bot'
import { Init } from '../init'

const bot = createBot()
bot.ready()

const init = new Init({ bot })

export const handler = bot.oninit(async ({ type, payload }) => {
  debugger
  if (type === 'init') {
    // initialize identity, keys, etc.
    // yes, this can be optimized, but it's a one time operation...
    await init.init(payload)
  } else if (type === 'update') {
    await init.update(payload)
  }
})
