import { TYPE } from '@tradle/constants'
import { Lambda, fromDynamoDB } from '../lambda'
import { createMiddleware } from '../middleware/onmessagestream'

const MODELS_PACK = 'tradle.ModelsPack'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  const { bot, tradle, tasks, logger } = lambda
  tasks.add({
    name: 'getiotendpoint',
    promiser: bot.iot.getEndpoint
  })

  // const { modelStore } = tradle
  // bot.hook('message', async ({ user, payload }) => {
  //   if (user.friend && payload[TYPE] === MODELS_PACK) {
  //     const modelsPack = payload
  //     try {
  //       await modelStore.addModelsPack({ modelsPack })
  //       return
  //     } catch (err) {
  //       logger.error(err.message, { modelsPack })
  //       return false
  //     }
  //   }
  // })

  return lambda.use(createMiddleware(lambda, opts))
}
