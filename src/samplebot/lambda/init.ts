process.env.LAMBDA_BIRTH_DATE = Date.now()

import { createBot } from '../../bot'
import { Init } from '../init'

const bot = createBot()
bot.ready()

const init = new Init({ bot })

export const handler = bot.oninit(async ({ type, payload }) => {
  if (type === 'init') {
    // initialize identity, keys, etc.
    // yes, this can be optimized, but it's a one time operation...
    await init.init(payload)
  } else if (type === 'setconf') {
    await init.update(payload)
  }
})
