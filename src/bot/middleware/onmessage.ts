// @ts-ignore
import Promise = require('bluebird')
import IotMessage = require('@tradle/iot-message')
import { Lambda } from '../../types'
import { fromDynamoDB } from '../lambda'
import Errors = require('../../errors')

const notNull = val => !!val

export const onMessage = (lambda, { onSuccess, onError }) => {
  const { logger, tradle, tasks, isUsingServerlessOffline } = lambda
  const { user } = tradle
  return async (ctx, next) => {
    const { clientId, friend, event } = ctx
    logger.debug(`preprocessing ${event.messages.length} messages`)
    event.messages = await Promise.mapSeries(event.messages, async (message, i) => {
      try {
        message = tradle.messages.normalizeInbound(message)
        message = await user.onSentMessage({ message, clientId, friend })
      } catch (error) {
        await onError({ clientId, message, error })
        return
      }

      await onSuccess({ clientId, message })
      return message
    })

    event.messages = event.messages.filter(notNull)
    const count = event.messages.length
    if (count) {
      logger.debug(`preprocessed ${count} messages`)
      await next()
    }
  }
}
