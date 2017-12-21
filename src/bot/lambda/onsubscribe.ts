import { Lambda, fromIot } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromIot(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { logger, tradle, bot } = lambda
  const { user, auth } = tradle
  return async (ctx, next) => {
    let { event } = ctx
    if (Buffer.isBuffer(event)) {
      ctx.event = event = JSON.parse(event.toString())
    }

    const { clientId, topics } = event
    await user.onSubscribed({ clientId, topics })
    logger.debug('client subscribed to MQTT topics', event)
    await next()
  }
}
