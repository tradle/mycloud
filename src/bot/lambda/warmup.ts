import { Lambda } from '../../types'
import { fromSchedule } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { tradle } = lambda
  const { lambdaUtils } = tradle
  return async (ctx, next) => {
    ctx.body = await lambdaUtils.warmUp(ctx.event)
    await next()
  }
}
