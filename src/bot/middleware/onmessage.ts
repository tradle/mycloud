// @ts-ignore
import Promise = require('bluebird')
import IotMessage = require('@tradle/iot-message')
import { Lambda, fromDynamoDB } from '../lambda'
import Errors = require('../../errors')

const notNull = val => !!val

export const onMessage = (lambda, { onSuccess, onError }) => {
  const { logger, tradle, tasks, isUsingServerlessOffline } = lambda
  const { user } = tradle
  return async (ctx, next) => {
    ctx.event.messages = await Promise.mapSeries(ctx.event.messages, async (message, i) => {
      try {
        message = tradle.messages.normalizeInbound(message)
        message = await user.onSentMessage({
          message,
          clientId: ctx.clientId,
          friend: ctx.friend
        })

      } catch (error) {
        await onError({ clientId: ctx.clientId, error, message })
        return
      }

      await onSuccess(message)
      return message
    })

    ctx.event.messages = ctx.event.messages.filter(notNull)
    if (ctx.event.messages.length) {
      logger.debug('preprocessed messages')
      await next()
    }
  }
}
