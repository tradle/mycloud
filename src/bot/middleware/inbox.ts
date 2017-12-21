// @ts-ignore
import Promise = require('bluebird')

const notNull = val => !!val

export const preProcess = (lambda, opts) => {
  const { logger, tradle } = lambda
  const { user } = tradle
  return async (ctx, next) => {
    const { messages } = ctx.event
    logger.debug(`preprocessing ${messages.length} messages in inbox`)
    ctx.messages = await user.onSentMessages({ messages })
    if (ctx.messages.length) {
      logger.debug(`preprocessed ${ctx.messages.length} messages in inbox`)
      await next()
    }
  }
}
