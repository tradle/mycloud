
import { fromLambda } from '../lambda'
import { DEPLOYMENT_UPDATE_STACK } from '../lambda-events'

const lambda = fromLambda({ event: DEPLOYMENT_UPDATE_STACK })

lambda.use(async (ctx) => {
  const { event } = ctx
  const { templateUrl, notificationTopics } = event
  await lambda.bot.stackUtils.updateStack({ templateUrl, notificationTopics })
})

export const handler = lambda.handler
