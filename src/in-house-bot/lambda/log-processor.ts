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
    bot.hookSimple('logs', processor.handleLogEvent)
  }

  await bot.fire('logs', event)
})

export const handler = lambda.handler
