import {
  Lambda,
  MiddlewareBase,
} from '../types'

import { fromIot } from '../lambda'

export const createMiddleware = ():MiddlewareBase => {
  const handleDisconnect = onDisconnected()
  const handleSubscribe = onSubscribed()
  return async (ctx, next) => {
    let { event, components } = ctx
    const { bot } = components
    const { userSim, logger } = bot
    if (Buffer.isBuffer(event)) {
      ctx.event = event = JSON.parse(event.toString())
    }

    const { topic, data } = event
    logger.debug(`iot lifecycle event: ${topic}`)

    if (topic.startsWith('$aws/events/subscriptions/subscribed')) {
      await handleSubscribe(ctx, next)
    } else if (topic.startsWith('$aws/events/subscriptions/unsubscribed')) {
      await handleDisconnect(ctx, next)
    }
  }
}

export const onDisconnected = ():MiddlewareBase => async (ctx, next) => {
  const { bot } = ctx.components
  const { logger, userSim, auth } = bot
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

export const onSubscribed = ():MiddlewareBase => async (ctx, next) => {
  const { bot } = ctx.components
  const { logger, userSim } = bot
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
