import { EventSource } from '../../lambda'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.DYNAMODB,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
  const { events } = lambda.tradle
  return async (ctx, next) => {
    const { event } = ctx
    const results = events.fromStreamEvent(event)
    if (results.length) {
      ctx.events = await events.putEvents(results)
    } else {
      ctx.events = results
    }

    await next()
  }
}
