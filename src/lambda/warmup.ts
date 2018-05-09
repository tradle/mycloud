import { Lambda } from '../types'
import { fromSchedule } from '../lambda'
import { DEFAULT_WARMUP_EVENT } from '../constants'

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { lambdaUtils } = lambda.bot
  return async (ctx, next) => {
    ctx.body = await lambdaUtils.warmUp({
      ...DEFAULT_WARMUP_EVENT,
      ...(ctx.event || {})
    })

    await next()
  }
}
