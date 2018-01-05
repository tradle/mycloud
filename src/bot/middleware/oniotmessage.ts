// @ts-ignore
import Promise = require('bluebird')
import IotMessage = require('@tradle/iot-message')
import { Lambda, fromDynamoDB } from '../lambda'
import Errors = require('../../errors')

const notNull = val => !!val

export const onMessage = (lambda, opts) => {
  const { logger, tradle, tasks, isUsingServerlessOffline } = lambda
  const { user } = tradle
  return async (ctx, next) => {
    const { event, context } = ctx
    let { topic, clientId, data } = event
    if (!clientId && isUsingServerlessOffline) {
      // serverless-offline support
      clientId = topic.match(/\/([^/]+)\/[^/]+/)[1]
    }

    ctx.clientId = clientId
    const buf = typeof data === 'string' ? new Buffer(data, 'base64') : data
    let messages
    let type
    let payload
    let decoded
    try {
      decoded = await IotMessage.decode(buf)
      type = decoded.type
      payload = JSON.parse(decoded.body.toString())
    } catch (err) {
      logger.error('client sent invalid MQTT payload', err.stack)
      await user.onIncompatibleClient({ clientId })
      return
    }

    if (type === 'announcePosition') {
      await user.onAnnouncePosition({
        clientId,
        position: payload
      })
    } else if (type === 'messages') {
      ctx.event.messages = payload
      await next()
    } else {
      this.logger.error('unsupported iot message type', decoded)
    }
  }
}

export const createSuccessHandler = (lambda, opts) => {
  const { tasks, logger, tradle } = lambda
  return async ({ clientId, message }) => {
    const { delivery } = tradle
    tasks.add({
      name: 'delivery:ack',
      promiser: async () => {
        await delivery.mqtt.ack({ clientId, message })
      }
    })

    logger.debug('received valid message from user')
  }
}

export const createErrorHandler = (lambda, opts) => {
  const { tasks, logger, tradle } = lambda
  const { delivery } = tradle
  return async ({ clientId, message, error }: {
    clientId,
    message,
    error?
  }):Promise<any|void> => {
    const progress = error && error.progress
    const ack = () => {
      tasks.add({
        name: 'delivery:ack',
        promiser: async () => {
          await delivery.mqtt.ack({ clientId, message: message || progress })
        }
      })
    }

    const reject = () => {
      tasks.add({
        name: 'delivery:reject',
        promiser: async () => {
          await delivery.mqtt.reject({
            clientId,
            message: progress,
            error
          })
        }
      })
    }

    logger.debug(`processing error in receive: ${error.name}`)
    if (error instanceof Errors.Duplicate) {
      logger.info('ignoring but acking duplicate message', {
        link: progress._link,
        author: progress._author
      })

      ack()
      return
    }

    if (error instanceof Errors.TimeTravel ||
      error instanceof Errors.NotFound ||
      error instanceof Errors.InvalidSignature ||
      error instanceof Errors.InvalidMessageFormat) {
      // HTTP
      let logMsg
      if (error instanceof Errors.TimeTravel) {
        logMsg = 'rejecting message with lower timestamp than previous'
        // @ts-ignore
      } else if (error instanceof Errors.NotFound || error instanceof Errors.UnknownAuthor) {
        logMsg = 'rejecting message, either sender or payload identity was not found'
        // @ts-ignore
      } else if (error instanceof Errors.InvalidMessageFormat) {
        logMsg = 'rejecting message, invalid message format'
      } else {
        logMsg = 'rejecting message, invalid signature'
      }

      logger.warn(logMsg, {
        message: progress,
        error: error.stack
      })

      reject()
      return
    }

    logger.error('unexpected error in pre-processing inbound message', {
      message: progress || message,
      error: error.stack
    })

    throw error
  }
}
