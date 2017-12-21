import { prettify } from '../../string-utils'
import { Lambda, EventSource, fromIot } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromIot(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts) => {
  const { logger, tradle, bot } = lambda
  const { user, auth } = tradle
  return async (ctx, next) => {
    let { event } = ctx
    if (Buffer.isBuffer(event)) {
      ctx.event = event = JSON.parse(event.toString())
    }

    logger.debug('client disconnected', prettify(event))
    const { clientId } = event
    await user.onDisconnected({ clientId })
    await bot.hooks.fire('useroffline', auth.getPermalinkFromClientId(clientId))
    await next()
  }
}
