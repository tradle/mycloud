import { fromLambda } from '../lambda'
import { DEPLOYMENT_UPDATE_STACK } from '../lambda-events'

const lambda = fromLambda({ event: DEPLOYMENT_UPDATE_STACK })
const { logger } = lambda

lambda.use(async ctx => {
  const { event, components } = ctx
  const { templateUrl, notificationTopics } = event
  await components.bot.stackUtils.updateStack({ templateUrl, notificationTopics })
})

export const handler = lambda.handler
