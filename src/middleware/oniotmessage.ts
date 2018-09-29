// @ts-ignore
import Promise from 'bluebird'
import IotMessage from '@tradle/iot-message'
import { Lambda, ILambdaExecutionContext } from '../types'
import Errors from '../errors'
import { summarizeObject } from '../utils'

const notNull = val => !!val

export const onMessage = () => async (ctx: ILambdaExecutionContext, next) => {
  const { bot } = ctx.components
  const { logger, isEmulated } = bot
  const { userSim } = bot
  const { event, context } = ctx
  let { topic, clientId, data } = event
  if (!clientId && isEmulated) {
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
    await userSim.onIncompatibleClient({ clientId })
    return
  }

  if (type === 'announcePosition') {
    await userSim.onAnnouncePosition({
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

export const createSuccessHandler = () => async ({ components }: ILambdaExecutionContext, { clientId, message }) => {
  const { bot } = components
  const { logger } = bot
  await bot.delivery.mqtt.ack({ clientId, message })
  logger.debug('acked message', summarizeObject(message))
}

export const createErrorHandler = () => async(ctx: ILambdaExecutionContext, { clientId, message, error }: {
  clientId: string
  message: any
  error?: any
}):Promise<any> => {
  const { bot } = ctx.components
  const { logger, delivery } = bot
  const progress = error && error.progress
  const ack = () => delivery.mqtt.ack({ clientId, message: message || progress })
  const reject = () => delivery.mqtt.reject({
    clientId,
    message: progress,
    error
  })

  logger.debug(`processing error in receive`, error)
  if (error instanceof Errors.Duplicate) {
    logger.info('ignoring but acking duplicate message', {
      link: progress._link,
      author: progress._author
    })

    await ack()
    return
  }

  if (Errors.isNotFound(error) ||
    error instanceof Errors.TimeTravel ||
    error instanceof Errors.InvalidSignature ||
    error instanceof Errors.InvalidMessageFormat) {
    // HTTP
    let logMsg
    if (error instanceof Errors.TimeTravel) {
      logMsg = 'rejecting message with lower timestamp than previous'
      // @ts-ignore
    } else if (Errors.isNotFound(error) || error instanceof Errors.UnknownAuthor) {
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

    await reject()
    return
  }

  logger.error('unexpected error in pre-processing inbound message', {
    message: progress || message,
    error: error.stack
  })

  throw error
}
