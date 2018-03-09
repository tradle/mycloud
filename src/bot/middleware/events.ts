import { Events } from '../../types'

export const createMiddleware = (events: Events) => async (ctx, next) => {
  const results = events.fromRawEvent(ctx.event)
  if (results.length) {
    await events.putEvents(results)
  }

  await next()
}
