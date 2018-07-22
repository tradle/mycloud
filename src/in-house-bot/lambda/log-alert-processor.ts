import { fromSNS } from '../lambda'
import { LOG_ALERTS } from '../lambda-events'
import {
  LogProcessor,
  parseLogAlertsTopicArn,
  fromLambda,
} from '../log-processor'

const lambda = fromSNS({ event: LOG_ALERTS })
const { bot, logger } = lambda
let processor: LogProcessor

lambda.use(async (ctx) => {
  const { event, components } = ctx
  if (!processor) {
    processor = fromLambda({ lambda, components })
    bot.hookSimple('logs:alerts', processor.handleAlertEvent)
  }

  await bot.fire('logs:alerts', event)
})

export const handler = lambda.handler
