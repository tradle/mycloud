import serverlessYml = require('../../cli/serverless-yml')
import { Lambda, fromLambda } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromLambda(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { logger, tradle } = lambda
  const { lambdaUtils } = tradle
  return async (ctx, next) => {
    const { event } = ctx
    logger.debug('reinitializing lambda containers', event)
    await lambdaUtils.forceReinitializeContainers(event.functions)
    await lambdaUtils.warmUp(lambdaUtils.getWarmUpInfo(serverlessYml).input)
    await next()
  }
}
