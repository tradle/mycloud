import { ILambdaExecutionContext } from '../types'

export const createMiddleware = () => async (ctx:ILambdaExecutionContext, next) => {
  const { event, components } = ctx
  await components.bot.fire(`stack:${event.type}`, event)
  await next()
}
