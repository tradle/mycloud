// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Lambda, Bot, IRetryableTaskOpts } from '../types'
import { topics as EventTopics, toBatchEvent } from '../events'
import { EventSource, fromDynamoDB } from '../lambda'
import { createMiddleware as createMessageMiddleware } from '../middleware/onmessagestream'
import { pluck, RESOLVED_PROMISE } from '../utils'
import Errors from '../errors'

const promiseUndefined = Promise.resolve(undefined)
// when to give up trying to find an object in object storage
const GIVE_UP_AGE = 60000

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  const { bot } = lambda

  bot.hook(EventTopics.message.stream.async.batch, createMessageMiddleware(bot, opts))
  return lambda.use(createMiddleware(bot, opts))
}

export const processMessages = async (bot: Bot, messages) => {
  bot.logger.debug(`processing ${messages.length} messages from stream`)
  await bot.fireBatch(EventTopics.message.stream.async, messages)
}

export const processResources = async (bot: Bot, resources) => {
  bot.logger.debug(`processing ${resources.length} resource changes from stream`)
  const changes = await Promise.map(resources, async (r) => {
    try {
      return await preProcessResourceRecord(bot, r)
    } catch (err) {
      Errors.ignore(err, Errors.GaveUp)
    }
  })
  .then(results => results.filter(_.identity))

  await bot._fireSaveBatchEvent({ changes, async: true, spread: true })
}

const getBody = async (bot, item) => {
  if (!item._link) return item

  if (item[TYPE] === 'tradle.Message') {
    return {
      ...item,
      object: {
        ...item.object,
        ...(await getBody(bot, item.object))
      }
    }
  }

  const age = item._time ? Date.now() - item._time : 0
  return await bot.objects.getWithRetry(item._link, {
    logger: bot.logger,
    maxAttempts: 10,
    maxDelay: 2000,
    timeout: 20000,
    initialDelay: 500,
    shouldTryAgain: err => {
      bot.logger.warn(`can't find object with link ${item._link}`)
      bot.logger.silly(`can't find object in object storage`, item)

      Errors.rethrow(err, 'developer')

      if (age < GIVE_UP_AGE) {
        throw new Errors.GaveUp(`gave up on looking up object ${item._link}`)
      }

      return Errors.isNotFound(err)
    }
  })
}

export const preProcessResourceRecord = async (bot: Bot, record) => {
  const [value, old] = await Promise.all([
    record.new ? getBody(bot, record.new) : promiseUndefined,
    record.old ? getBody(bot, record.old) : promiseUndefined
  ])

  return { value, old }
}

export const createMiddleware = (bot:Bot, opts?:any) => {
  const { db, dbUtils, objects, logger } = bot
  return async (ctx, next) => {
    const records = dbUtils.getRecordsFromEvent(ctx.event)
    const [messages, resources] = _.partition(records, isMessageRecord)
    const promiseMessages = messages.length ? processMessages(bot, pluck(messages, 'new')) : promiseUndefined
    const promiseResources = resources.length ? processResources(bot, resources) : promiseUndefined
    await Promise.all([promiseMessages, promiseResources])
  }
}

const isMessageRecord = r => r.new && r.new[TYPE] === 'tradle.Message'
