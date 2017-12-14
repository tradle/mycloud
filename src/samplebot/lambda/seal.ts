import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda()
lambda.use(async (ctx) => {
  await bot.seal(ctx.event)
})

export const handler = lambda.handler
