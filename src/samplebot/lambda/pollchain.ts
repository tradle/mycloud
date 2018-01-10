
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.pollchain()
lambda.use(async (ctx, next) => {
  ctx.body = ctx.seals || {}
})

export const handler = lambda.handler
