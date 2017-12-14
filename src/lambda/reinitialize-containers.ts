import { Lambda, EventSource } from '../lambda'
import { tradle } from '../'
import serverlessYml = require('../cli/serverless-yml')

const { lambdaUtils } = tradle
const lambda = new Lambda({ source: EventSource.LAMBDA })
lambda.use(async (ctx) => {
  const { event } = ctx
  lambda.logger.debug('reinitializing lambda containers', event)
  await lambdaUtils.forceReinitializeContainers(event.functions)
  await lambdaUtils.warmUp(lambdaUtils.getWarmUpInfo(serverlessYml).input)
})

export const handler = lambda.handler
