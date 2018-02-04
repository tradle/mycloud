
import { createBot } from '../../bot'
import { sendConfirmedSeals } from '../utils'

const bot = createBot()
const lambda = bot.lambdas.sealpending()
lambda.use(async (ctx) => {
  const { seals=[] } = ctx
  ctx.body = seals
  await sendConfirmedSeals(bot, seals)
})

export const handler = lambda.handler
