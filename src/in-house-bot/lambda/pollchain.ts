import { createBot } from '../../'
import { sendConfirmedSeals } from '../utils'

const bot = createBot()
const lambda = bot.lambdas.pollchain()
lambda.use(async (ctx, next) => {
  const { seals=[] } = ctx
  ctx.body = seals
  await sendConfirmedSeals(bot, seals)
})

export const handler = lambda.handler
