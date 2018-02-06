import { createBot } from '../../bot'
import { IIdentity } from '../../types'

const bot = createBot()
const lambda = bot.createLambda()
lambda.use(async ({ event }) => {
  const { link } = event
  lambda.logger.debug('adding contact', link)
  const identity = await bot.objects.get(link)
  return bot.identities.addContact(identity as IIdentity)
})

export const handler = lambda.handler
