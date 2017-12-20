import { EventSource } from '../../lambda'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.SCHEDULE,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
  const { bot, tradle } = lambda
  const { seals } = tradle
  return async (ctx, next) => {
    ctx.seals = await seals.sealPending()
    await next()
  }
}
