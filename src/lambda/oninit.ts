import { Lambda } from '../types'
import { fromCloudFormation } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromCloudFormation(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  return async (ctx, next) => {
    const { event } = ctx
    await bot.fire(`stack:${event.type}`, ctx.event)
    await next()
  }
}
