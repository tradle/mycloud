process.env.LAMBDA_BIRTH_DATE = Date.now()

import { createBot } from '../../bot'
import { createConf } from '../configure'

const bot = createBot()
const conf = createConf(bot)
export const handler = bot.createHandler(async (event) => {
  await conf.setStyle(event)
}, { source: 'lambda' })
