
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.sealpending()
lambda.use(async (ctx) => {
  ctx.body = ctx.seals || []
})

export const handler = lambda.handler
