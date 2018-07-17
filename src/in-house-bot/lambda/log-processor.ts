import { fromCloudwatchLogs } from '../lambda'
import { LOGS } from '../lambda-events'
import { fromLambda } from '../log-processor'

const lambda = fromCloudwatchLogs({ event: LOGS })
const { bot, logger } = lambda
const processor = fromLambda(lambda)
bot.hookSimple('logs', processor.handleEvent)

lambda.use(async (ctx) => {
  const { event } = ctx
  await bot.fire('logs', event)
})

export const handler = lambda.handler
