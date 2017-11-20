
import { createTradle } from '../../'
import { createBot } from '../../bot'
import Init from '../init'

const tradle = createTradle()
const bot = createBot(tradle)

export const handler = bot.wrapInit(async ({ type, payload }) => {
  const init = new Init({
    bot,
    tradle,
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
