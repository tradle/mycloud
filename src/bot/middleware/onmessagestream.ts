// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import Errors from '../../errors'
import { getRecordsFromEvent } from '../../db-utils'
import {
  batchProcess,
  ensureTimestamped,
  promiseNoop,
  wait,
  uniqueStrict,
  extendTradleObject
} from '../../utils'

import { onMessagesSaved } from './onmessagessaved'
// import { createMiddleware as createSaveEvents } from './events'
import {
  ISettledPromise,
  ITradleMessage,
  Bot,
  Logger
} from '../../types'

import { topics } from '../../events'

const S3_GET_ATTEMPTS = 3
const S3_FAILED_GET_INITIAL_RETRY_DELAY = 1000

export const createMiddleware = (bot:Bot, opts?:any) => {
  const { events, logger } = bot
  const logAndThrow = (results) => {
    const failed = results.map(({ reason }) => reason)
      .filter(reason => reason)

    if (failed.length) {
      logger.debug('failed to save payloads', failed)
      throw new Error(failed[0])
    }
  }

  const postProcess = createBatchPostProcessor(bot, opts)
  const processStream = async (ctx, next) => {
    const messages = ctx.event
    await events.putEvents(messages.map(toMessageEvent))
    // event.bot = bot

    const preResults:ISettledPromise<ITradleMessage>[] = await batchProcess({
      data: messages,
      batchSize: 20,
      processOne: message => preProcessOne(bot, message),
      settle: true
    })

    const successes = preResults
      .filter(result => result.value)
      .map(result => result.value)

    const postResults = await postProcess(messages)

    // const postResults = await batchProcess({
    //   data: successes,
    //   batchSize: 20,
    //   processOne: postProcess
    // })

    logAndThrow(preResults)
    await next()
  }

  return processStream
}

export const preProcessOne = async (bot: Bot, message) => {
  const payload = message.object
  const type = message._payloadType
  let maxAttempts = S3_GET_ATTEMPTS
  let delay = S3_FAILED_GET_INITIAL_RETRY_DELAY
  let body
  while (maxAttempts--) {
    try {
      body = await bot.objects.get(payload._link)
      extendTradleObject(payload, body)
    } catch (err) {
      // TODO: implement retry/fallback policy
      Errors.ignoreNotFound(err)
      await wait(delay)
      delay *= 2
    }
  }

  return message
}

export const createBatchPostProcessor = (bot, opts) => {
  const { logger } = bot
  const businessLogicMiddleware = onMessagesSaved(bot, { async: true })
  return async (messages) => {
    const ctx = { event: { messages } }
    try {
      await businessLogicMiddleware(ctx, promiseNoop)
    } catch (err) {
      // TODO: implement retry/fallback policy
      logger.debug('failure in custom onmessagestream middleware', {
        messages,
        error: Errors.export(err)
      })
    }
  }
}

const toMessageEvent = message => ({
  topic: (message._inbound ? topics.message.inbound : topics.message.outbound).toString(),
  data: message,
  time: message.time
})
