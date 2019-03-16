import { ILambdaExecutionContext } from '../types'

export const createMiddleware = () => async (ctx: ILambdaExecutionContext, next) => {
  const { bot } = ctx.components
  const { logger, lambdaInvoker, stackUtils } = bot
  const { event } = ctx
  logger.debug('reinitializing lambda containers', event)
  await stackUtils.reinitializeContainers(event.functions)
  await lambdaInvoker.scheduleWarmUp()
  await next()
}
