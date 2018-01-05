import { TYPE } from '@tradle/constants'
import { Lambda, fromDynamoDB } from '../lambda'
import { createMiddleware } from '../middleware/onmessagestream'

const MODELS_PACK = 'tradle.ModelsPack'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  const { bot, tradle, logger, tasks } = lambda
  tasks.add({
    name: 'getiotendpoint',
    promiser: bot.iot.getEndpoint
  })

  bot.hook('message', async ({ user, payload }) => {
    if (user.friend && payload[TYPE] === MODELS_PACK) {
      try {
        await tradle.modelStore.updateCumulativeModelsPackWithPack(payload)
      } catch (err) {
        logger.error(err.message, { pack: payload })
        return false
      }
    }
  })

  return lambda.use(createMiddleware(lambda, opts))
}
