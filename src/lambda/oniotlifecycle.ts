import { Lambda } from '../types'
import { fromIot } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromIot(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda: Lambda, opts) => {
  const { logger, bot } = lambda
  const { userSim } = bot
  const handleConnect = onConnected(lambda, opts)
  const handleDisconnect = onDisconnected(lambda, opts)
  const handleSubscribe = onSubscribed(lambda, opts)
  return async (ctx, next) => {
    let { event } = ctx
    if (Buffer.isBuffer(event)) {
      ctx.event = event = JSON.parse(event.toString())
    }

    const { topic, data } = event
    logger.debug(`iot lifecycle event: ${topic}`)

    if (topic.startsWith('$aws/events/presence/connected')) {
      await handleConnect(ctx, next)
    } else if (topic.startsWith('$aws/events/presence/disconnected')) {
      await handleDisconnect(ctx, next)
    } else if (topic.startsWith('$aws/events/subscriptions/subscribed')) {
      await handleSubscribe(ctx, next)
    }
  }
}

export const onConnected = (lambda: Lambda, opts) => {
  const { logger, bot } = lambda
  return async (ctx, next) => {
    const { clientId } = ctx.event.data
    const session = await bot.userSim.onConnected({ clientId })
    if (session) {
      await bot.fire('user:online', session.permalink)
      await next()
    }
  }
}

export const onDisconnected = (lambda: Lambda, opts) => {
  const { logger, bot } = lambda
  const { userSim, auth } = bot
  return async (ctx, next) => {
    const { clientId } = ctx.event.data
    await userSim.onDisconnected({ clientId })
    await bot.fire('user:offline', auth.getPermalinkFromClientId(clientId))
    await next()
  }
}

export const onSubscribed = (lambda, opts) => {
  const { logger, bot } = lambda
  const { userSim } = bot
  return async (ctx, next) => {
    const { clientId, topics } = ctx.event.data
    await userSim.onSubscribed({ clientId, topics })
    logger.debug('client subscribed to MQTT topics', { clientId, topics })
    await next()
  }
}
