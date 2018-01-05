import typeforce = require('typeforce')
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda()
lambda.use(async ({ event }) => {
  typeforce({
    url: 'String',
    domain: 'String'
  }, event)

  await bot.friends.load(event)
})

export const handler = lambda.handler
