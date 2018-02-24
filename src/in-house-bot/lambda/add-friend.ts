import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda()
lambda.use(async ({ event }) => {
  const { url, domain } = event
  await bot.friends.load({ url, domain })
})

export const handler = lambda.handler
