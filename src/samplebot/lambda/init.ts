
import { createBot } from '../../bot'
import { Init } from '../init'

const bot = createBot()

export const handler = bot.oninit(async ({ type, payload }) => {
  const init = new Init({
    bot,
    conf: payload
  })

  if (type === 'init') {
    // initialize identity, keys, etc.
    // yes, this can be optimized, but it's a one time operation...
    await init.init()
  } else if (type === 'update') {
    await init.update()
  }
})
