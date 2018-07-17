import { Lambda } from '../types'
import { fromLambda } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromLambda(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { logger, bot } = lambda
  const { lambdaUtils, stackUtils } = bot
  return async (ctx, next) => {
    const { event } = ctx
    logger.debug('reinitializing lambda containers', event)
    await stackUtils.forceReinitializeContainers(event.functions)
    await lambdaUtils.scheduleWarmUp()
    await next()
  }
}
