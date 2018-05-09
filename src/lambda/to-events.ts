// NOT USED

import { Lambda } from '../types'
import { fromDynamoDB } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { events } = lambda.bot
  return async (ctx, next) => {
    const { event } = ctx
    const results = events.fromRawEvent(event)
    if (results.length) {
      ctx.events = await events.putEvents(results)
    } else {
      ctx.events = results
    }

    await next()
  }
}
