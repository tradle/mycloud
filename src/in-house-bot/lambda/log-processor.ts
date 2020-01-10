import { fromCloudwatchLogs } from '../lambda'
import { LOGS } from '../lambda-events'
import { LogProcessor, fromLambda } from '../log-processor'

const lambda = fromCloudwatchLogs({ event: LOGS })
const { bot, logger } = lambda
let processor: LogProcessor

lambda.use(async (ctx) => {
  const { event, components } = ctx
  if (!processor) {
    processor = fromLambda({ lambda, components })
    bot.hook(bot.events.topics.logging.logs, async (ctx, next) => {
      ctx.event = await processor.parseLogEvent(ctx.event)
      await processor.handleLogEvent(ctx.event)
    })
  }

  await bot.fire(bot.events.topics.logging.logs, event)
})

export const handler = lambda.handler
