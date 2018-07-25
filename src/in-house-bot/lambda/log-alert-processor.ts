import { fromSNS } from '../lambda'
import { LOG_ALERTS } from '../lambda-events'
import {
  LogProcessor,
  parseLogAlertsTopicArn,
  fromLambda,
  sendLogAlert,
} from '../log-processor'

const lambda = fromSNS({ event: LOG_ALERTS })
const { bot, logger } = lambda
let processor: LogProcessor

lambda.use(async (ctx) => {
  const { event, components } = ctx
  if (!processor) {
    const conf = components.conf.bot.logging
    processor = fromLambda({ lambda, components })
    bot.hook(bot.events.topics.logging.alert, async (ctx, next) => {
      const alert = ctx.event = await processor.handleAlertEvent(ctx.event)
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
