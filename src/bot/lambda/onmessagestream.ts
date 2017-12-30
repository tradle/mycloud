// @ts-ignore
import Promise = require('bluebird')
import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import Errors = require('../../errors')
import { getRecordsFromEvent } from '../../db-utils'
import { getMessagePayload } from '../utils'
import { batchProcess, ensureTimestamped, promiseNoop } from '../../utils'
import { savePayloadToDB } from '../utils'
import { Lambda, fromDynamoDB } from '../lambda'
import { onMessagesSaved } from '../middleware/onmessagessaved'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { tradle, bot, logger } = lambda
  const logAndThrow = (results) => {
    const failed = results.map(({ reason }) => reason)
      .filter(reason => reason)

    if (failed.length) {
      logger.debug('failed to save payloads', failed)
      throw new Error(failed[0])
    }
  }

  const preProcess = preProcessOne(lambda, opts)
  const postProcess = postProcessOne(lambda, opts)
  return async (ctx, next) => {
    const { event } = ctx
    event.bot = bot
    // unmarshalling is prob a waste of time
    const messages = getRecordsFromEvent(event)
    ctx.results = await batchProcess({
      data: messages,
      batchSize: 20,
      processOne: preProcess,
      settle: true
    })

    const successes = ctx.results
      .filter(result => result.value)
      .map(result => result.value)

    await batchProcess({
      data: successes,
      batchSize: 20,
      processOne: postProcess
    })

    logAndThrow(ctx.results)
    await next()
  }
}

export const preProcessOne = (lambda, opts) => {
  const { bot, logger } = lambda
  return async (message) => {
    const payload = message.object
    const type = message._payloadType
    const todo = [
      () => savePayloadToDB({ bot, message })
    ]

    if (type === MODELS_PACK) {
      todo.push(() => tradle.modelStore)
    }

    try {
      await savePayloadToDB({ bot, message })
      logger.debug('saved', _.pick(payload, [TYPE, '_permalink']))
    } catch (err) {
      // TODO: to DLQ
      logger.debug('failed to put to db', {
        type,
        link: payload._link,
        error: err.stack
      })

      throw err
    }

    return message
  }
}

export const postProcessOne = (lambda, opts) => {
  const { logger } = lambda
  const businessLogicMiddleware = onMessagesSaved(lambda, opts)
  return async (message) => {
    const subCtx = { ...lambda.execCtx, event: message }
    try {
      await businessLogicMiddleware(subCtx, promiseNoop)
    } catch (err) {
      logger.debug('failure in custom onmessagestream middleware', {
        message: message,
        error: Errors.export(err)
      })
    }
  }
}
