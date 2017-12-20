import { EventSource } from '../../lambda'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.SCHEDULE,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
  const { tradle } = lambda
  const { lambdaUtils } = tradle
  return async (ctx, next) => {
    ctx.body = await lambdaUtils.warmUp(ctx.event)
    await next()
  }
}
