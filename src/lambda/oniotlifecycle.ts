import { Lambda } from '../types'
import { fromIot } from '../lambda'

export const createLambda = opts => {
  const lambda = fromIot(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda: Lambda, opts) => {
  const { logger, bot } = lambda
  const { userSim } = bot
  const handleSubscribe = onSubscribed(lambda, opts)
  const handleDisconnect = onDisconnected(lambda, opts)
  return async (ctx, next) => {
    let { event } = ctx
    if (Buffer.isBuffer(event)) {
      ctx.event = event = JSON.parse(event.toString())
    }

    const { topic, data } = event
    logger.debug(`iot lifecycle event: ${topic}`)

    if (topic.startsWith('$aws/events/subscriptions/subscribed')) {
      await handleSubscribe(ctx, next)
    } else if (topic.startsWith('$aws/events/presence/disconnected')) {
      await handleDisconnect(ctx, next)
    }
  }
}

export const onDisconnected = (lambda: Lambda, opts) => {
  const { logger, bot } = lambda
  const { userSim, auth } = bot
  return async (ctx, next) => {
    const { clientId } = ctx.event.data
    try {
      await userSim.onDisconnected({ clientId })
      await bot.fire('user:offline', auth.getPermalinkFromClientId(clientId))
    } catch (err) {
      logger.debug('failed to handle disconnect event', err)
      return
    }

    await next()
  }
}

export const onSubscribed = (lambda, opts) => {
  const { logger, bot } = lambda
  const { userSim } = bot
  return async (ctx, next) => {
    const { clientId, topics } = ctx.event.data
    try {
      await userSim.onSubscribed({ clientId, topics })
      logger.debug('client subscribed to MQTT topics', { clientId, topics })
    } catch (err) {
      logger.debug('failed to handle subscribe event', err)
      return
    }

    await next()
  }
}
