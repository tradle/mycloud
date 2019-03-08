import { fromLambda } from '../lambda'
import { DEPLOYMENT_UPDATE_STACK } from '../lambda-events'

const lambda = fromLambda({ event: DEPLOYMENT_UPDATE_STACK })
const { bot, logger } = lambda

lambda.use(async ctx => {
  const { event } = ctx
  const { templateUrl, notificationTopics } = event
  await bot.stackUtils.updateStack({ templateUrl, notificationTopics })
})

export const handler = lambda.handler
