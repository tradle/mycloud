import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda()
lambda.use(async ({ event }) => {
  const { link } = event
  lambda.logger.debug('adding contact', link)
  return bot.identities.addContact({ link })
})

export const handler = lambda.handler
