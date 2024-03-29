import compose from 'koa-compose'
import cors from 'kcors'
import { bodyParser } from '../middleware/body-parser'
import { route } from '../middleware/noop-route'
import { Lambda } from '../types'
import { fromHTTP } from '../lambda'
import { onMessage as onMessageInInbox, createSuccessHandler, createErrorHandler } from '../middleware/inbox'
import { onMessage } from '../middleware/onmessage'
import { onMessagesSaved } from '../middleware/onmessagessaved'
import { topics as EventTopics } from '../events'

const MODELS_PACK = 'tradle.ModelsPack'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  const { bot, logger } = lambda

  lambda.tasks.add({
    name: 'getkeys',
    promiser: bot.identity.getPrivate
  })

  bot.hook(EventTopics.message.inbound.sync, async (ctx, next) => {
    const { type, payload, user } = ctx.event
    lambda.tasks.add({
      name: 'reset-delivery-error',
      promiser: () => bot.delivery.http.resetError({ counterparty: user.id })
    })

    if (type === MODELS_PACK) {
      try {
        await bot.modelStore.addModelsPack({
          modelsPack: payload,
          validateAuthor: true,
          // unfortunately we have to be more forgiving of other myclouds
          // than of ourselves, and allow them to remove models (for now)
          allowRemoveModels: true,
        })
      } catch (err) {
        logger.error(err.message, { modelsPack: payload })
        return // prevent further processing
      }
    }

    await next()
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
    onMessagesSaved(lambda.bot, opts)
  ])
}
