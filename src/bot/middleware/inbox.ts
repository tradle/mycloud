// @ts-ignore
import Promise = require('bluebird')
import { Lambda, fromDynamoDB } from '../lambda'

const notNull = val => !!val

export const preProcess = (lambda:Lambda, opts?:any) => {
  const { logger, tradle } = lambda
  const { user } = tradle
  return async (ctx, next) => {
    const { messages } = ctx.event
    if (!messages) {
      ctx.body = {
        message: 'invalid payload, expected {"messages":[]}'
      }

      ctx.status = 400
      return
    }

    logger.debug(`preprocessing ${messages.length} messages in inbox`)
    ctx.messages = await user.onSentMessages({ messages })
    if (ctx.messages.length) {
      logger.debug(`preprocessed ${ctx.messages.length} messages in inbox`)
      await next()
    }
  }
}
