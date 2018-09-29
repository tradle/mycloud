import { fromSNS } from '../lambda'
import { LOG_ALERTS } from '../lambda-events'
import Errors from '../../errors'
import {
  LogProcessor,
  fromLambda,
  sendLogAlert,
} from '../log-processor'

const lambda = fromSNS({ event: LOG_ALERTS })
const { logger } = lambda
let processor: LogProcessor

lambda.use(async (ctx) => {
  const { event, components } = ctx
  const { bot } = components
  if (!processor) {
    const conf = components.conf.bot.logging
    processor = fromLambda({ lambda, components })
    bot.hook(bot.events.topics.logging.alert, async (ctx, next) => {
      try {
        ctx.event = await processor.parseAlertEvent(ctx.event)
      } catch (err) {
        Errors.rethrow(err, 'developer')
        logger.debug('invalid alert event', {
          stage: 'parse',
          error: Errors.export(err),
          event: ctx.event,
        })

        return
      }

      const alert = ctx.event
      try {
        await processor.handleAlertEvent(alert)
      } catch (err) {
        Errors.rethrow(err, 'developer')
        logger.debug('invalid alert event', {
          stage: 'load',
          error: Errors.export(err),
          event: ctx.event,
        })

        return
      }

      if (conf) {
        await sendLogAlert({ bot, conf, alert })
      } else {
        logger.debug('logging conf not present, not emailing anyone')
      }

      await next()
    })
  }

  await bot.fire(bot.events.topics.logging.alert, event)
})

export const handler = lambda.handler
