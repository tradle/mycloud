import compose from 'koa-compose'
import cors from 'kcors'
import once from 'lodash/once'
import { bodyParser } from '../middleware/body-parser'
import { route } from '../middleware/noop-route'
import { Lambda, Bot, ILambdaExecutionContext } from '../types'
import { fromHTTP } from '../lambda'
import { onMessage as onMessageInInbox, createSuccessHandler, createErrorHandler } from '../middleware/inbox'
import { onMessage } from '../middleware/onmessage'
import { onMessagesSaved } from '../middleware/onmessagessaved'
import { topics as EventTopics } from '../events'

const MODELS_PACK = 'tradle.ModelsPack'

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const hookUp = once(async (bot: Bot) => {
    debugger
    lambda.tasks.add({
      name: 'getkeys',
      promiser: bot.identity.getPrivate
    })

    const { logger } = lambda
    bot.hook(EventTopics.message.inbound.sync, async (ctx, next) => {
      const { type, payload } = ctx.event
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
  })

  return compose([
    (ctx:ILambdaExecutionContext, next) => hookUp(ctx.components.bot).then(next),
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
