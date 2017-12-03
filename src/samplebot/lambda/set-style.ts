import '../../init-lambda'

import { createBot } from '../../bot'
import { createConf } from '../configure'

const bot = createBot()
bot.ready()

const conf = createConf(bot)
export const handler = bot.createHandler(async (event) => {
  await conf.setStyle(event)
}, { source: 'lambda' })
