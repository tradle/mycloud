import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda()
lambda.use(async ({ event }) => {
  const { url } = event
  if (!url) {
    throw new Error('"url" is required')
  }

  await bot.friends.load({ url })
})

export const handler = lambda.handler
