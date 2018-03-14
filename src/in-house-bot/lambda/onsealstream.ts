
import { createBot } from '../../bot'
import { sendConfirmedSeals } from '../utils'
import { topics as EventTopics } from '../../events'

const bot = createBot()
const lambda = bot.lambdas.onsealstream()
const { logger, env } = lambda
if (env.BLOCKCHAIN.flavor === 'corda') {
  bot.hookSimple(EventTopics.seal.queuewrite.async, async (seal) => {
    logger.debug('attempting to write seal immediately')
    try {
      const result = await bot.seals.writePendingSeal({ seal })
      if (result) {
        await sendConfirmedSeals(bot, [result])
      }
    } catch (err) {
      logger.error('failed to write seal', err)
    }
  })
}

export const handler = lambda.handler
