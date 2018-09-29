import { Lambda, ILambdaExecutionContext } from '../types'

export const createMiddleware = () => async (ctx: ILambdaExecutionContext, next) => {
  const { bot } = ctx.components
  const { logger, lambdaUtils, stackUtils } = bot
  const { event } = ctx
  logger.debug('reinitializing lambda containers', event)
  await stackUtils.forceReinitializeContainers(event.functions)
  await lambdaUtils.scheduleWarmUp()
  await next()
}
