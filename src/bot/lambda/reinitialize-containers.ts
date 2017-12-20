import serverlessYml = require('../../cli/serverless-yml')
import { EventSource } from '../../lambda'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.LAMBDA,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
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
