import {
  Lambda,
  ILambdaExecutionContext,
} from '../types'

import { fromIot } from '../lambda'

export const createMiddleware = () => {
  const handleConnect = onConnected()
  const handleDisconnect = onDisconnected()
  const handleSubscribe = onSubscribed()
  return async (ctx: ILambdaExecutionContext, next) => {
    let { event, components } = ctx
    const { bot } = components
    const { userSim, logger } = bot
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

export const onConnected = () => async (ctx:ILambdaExecutionContext, next) => {
  const { bot } = ctx.components
  const { logger, userSim } = bot
  const { clientId } = ctx.event.data
  const session = await userSim.onConnected({ clientId })
  if (session) {
    await bot.fire('user:online', session.permalink)
    await next()
  }
}

export const onDisconnected = () => {
  return async (ctx: ILambdaExecutionContext, next) => {
    const { bot } = ctx.components
    const { logger, userSim, auth } = bot
    const { clientId } = ctx.event.data
    await userSim.onDisconnected({ clientId })
    await bot.fire('user:offline', auth.getPermalinkFromClientId(clientId))
    await next()
  }
}

export const onSubscribed = () => {
  return async (ctx: ILambdaExecutionContext, next) => {
    const { bot } = ctx.components
    const { logger, userSim } = bot
    const { clientId, topics } = ctx.event.data
    await userSim.onSubscribed({ clientId, topics })
    logger.debug('client subscribed to MQTT topics', { clientId, topics })
    await next()
  }
}
