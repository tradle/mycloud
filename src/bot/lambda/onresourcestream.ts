// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Lambda, Bot } from '../../types'
import { topics as EventTopics, toBatchEvent } from '../../events'
import { EventSource, fromDynamoDB } from '../lambda'
import { createMiddleware as createMessageMiddleware } from '../middleware/onmessagestream'
import { pluck, RESOLVED_PROMISE } from '../../utils'

const promiseUndefined = Promise.resolve(undefined)

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
  const changes = await Promise.all(resources.map(r => preProcessResourceRecord(bot, r)))
  await bot._fireSaveBatchEvent({ changes, async: true, spread: true })
}

export const preProcessResourceRecord = async (bot: Bot, record) => {
  const getBody = partial => partial._link ? bot.objects.get(partial._link) : partial
  const [value, old] = await Promise.all([
    record.new ? getBody(record.new) : promiseUndefined,
    record.old ? getBody(record.old) : promiseUndefined
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
