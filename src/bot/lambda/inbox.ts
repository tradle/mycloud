import compose = require('koa-compose')
import cors = require('kcors')
import { bodyParser } from '../middleware/body-parser'
import { route } from '../middleware/noop-route'
import { Lambda, fromHTTP } from '../lambda'
import { onMessage as onMessageInInbox, createSuccessHandler, createErrorHandler } from '../middleware/inbox'
import { onMessage } from '../middleware/onmessage'
import { onMessagesSaved } from '../middleware/onmessagessaved'

const MODELS_PACK = 'tradle.ModelsPack'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  const { bot, logger } = lambda
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: bot.iot.getEndpoint
  })

  bot.hook('message', async ({ type, payload }) => {
    if (type !== MODELS_PACK) return

    try {
      await bot.modelStore.addModelsPack({ modelsPack: payload })
    } catch (err) {
      logger.error(err.message, { modelsPack: payload })
      return false
    }
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  return compose([
    route(['post', 'put']),
    cors(),
    bodyParser({ jsonLimit: '10mb' }),
    onMessageInInbox(lambda, opts),
    onMessage(lambda, {
      onSuccess: createSuccessHandler(lambda, opts),
      onError: createErrorHandler(lambda, opts)
    }),
    onMessagesSaved(lambda, opts)
  ])
}
