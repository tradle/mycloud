
import { fromLambda } from '../lambda'
import { DEPLOYMENT_UPDATE_STACK } from '../lambda-events'

const lambda = fromLambda({ event: DEPLOYMENT_UPDATE_STACK })

lambda.use(async (ctx) => {
  const { event, components } = ctx
  const { templateUrl, notificationTopics } = event
  const { deployment } = components
  await deployment.updateOwnStack({ templateUrl, notificationTopics })
})

export const handler = lambda.handler
