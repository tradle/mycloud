// @ts-ignore
import Promise = require('bluebird')
import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import Errors = require('../../errors')
import { getRecordsFromEvent } from '../../db-utils'
import { batchProcess, ensureTimestamped, promiseNoop, wait } from '../../utils'
import { Lambda, fromDynamoDB } from '../lambda'
import { onMessagesSaved } from './onmessagessaved'

const S3_GET_ATTEMPTS = 3
const S3_FAILED_GET_INITIAL_RETRY_DELAY = 1000

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
    const preResults = await batchProcess({
      data: messages,
      batchSize: 20,
      processOne: preProcess,
      settle: true
    })

    const successes = preResults
      .filter(result => result.value)
      .map(result => result.value)

    const postResults = await batchProcess({
      data: successes,
      batchSize: 20,
      processOne: postProcess
    })

    logAndThrow(preResults)
    await next()
  }
}

export const preProcessOne = (lambda:Lambda, opts) => {
  const { bot, logger } = lambda
  return async (message) => {
    const payload = message.object
    const type = message._payloadType
    let maxAttempts = S3_GET_ATTEMPTS
    let delay = S3_FAILED_GET_INITIAL_RETRY_DELAY
    while (maxAttempts--) {
      try {
        message.object = await bot.objects.get(message.object._link)
      } catch (err) {
        Errors.ignore(err, Errors.NotFound)
        await wait(delay)
        delay *= 2
      }
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
