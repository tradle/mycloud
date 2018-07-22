import { fromSNS } from '../lambda'
import { LOG_ALERTS } from '../lambda-events'
// import { fromLambda } from '../log-alert-processor'

const lambda = fromSNS({ event: LOG_ALERTS })
const { bot, logger } = lambda

lambda.use(async (ctx) => {
  const { event } = ctx
  console.log('EVENT', JSON.stringify(event))
  // await bot.buckets.Logs.putJSON(``, event)
  await bot.fire('logs:alerts', event)
})

export const handler = lambda.handler
