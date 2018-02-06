import { Lambda } from '../../types'
import { EventSource, fromIot } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromIot(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts ) => {
  const { logger, tradle, bot } = lambda
  const { user } = tradle
  return async (ctx, next) => {
    let { event } = ctx
    if (Buffer.isBuffer(event)) {
      ctx.event = event = JSON.parse(event.toString())
    }

    logger.debug('client connected', event)
    const { clientId } = event
    const session = await user.onConnected({ clientId })
    if (session) {
      await bot.hooks.fire('user:online', session.permalink)
      await next()
    }
  }
}
