// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Lambda, Bot, IRetryableTaskOpts, IStreamRecord, ITradleMessage } from '../types'
import { topics as EventTopics, toBatchEvent } from '../events'
import { EventSource, fromDynamoDB } from '../lambda'
import { onMessagesSaved } from '../middleware/onmessagessaved'
// import { createMiddleware as createMessageMiddleware } from '../middleware/onmessagestream'
import { pluck, RESOLVED_PROMISE } from '../utils'
import Errors from '../errors'
import Events from '../events'
import { StreamProcessor } from '../stream-processor'

const promiseUndefined = Promise.resolve(undefined)
// when to give up trying to find an object in object storage
const GIVE_UP_AGE = 60000
const SAFETY_MARGIN_MILLIS = 10000

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda.bot))
}

export const processMessageEvent = async (bot: Bot, record: IStreamRecord) => {
  await bot._fireMessagesRaw({ messages: [record.value], async: true })
}

export const processResourceChangeEvent = async (bot: Bot, change: IStreamRecord) => {
  const { value, old } = change
  if (value) {
    await bot._fireSaveEvent({ change: { value, old }, async: true })
  }
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

export const preProcessItem = async <T>(bot: Bot, record):Promise<T> => {
  const [value, old] = await Promise.all([
    record.value ? getBody(bot, record.value) : promiseUndefined,
    record.old ? getBody(bot, record.old) : promiseUndefined
  ])

  return { value, old }
}

export const createMiddleware = (bot:Bot) => {
  const { dbUtils, streamProcessor } = bot
  return async (ctx, next) => {
    const records = dbUtils.getRecordsFromEvent(ctx.event)
    await processRecords({ bot, records })
  }
}

export const processRecords = async ({ bot, records }: {
  bot: Bot
  records: IStreamRecord[]
}) => {
  const { dbUtils, streamProcessor } = bot
  // records.forEach(record => {
  //   // @ts-ignore
  //   record.laneId = getLaneId(record)
  // })

  const byCat = _.groupBy(records, Events.getEventCategory)
  if (byCat.resource) {
    byCat.resource.forEach(r => {
      // prime cache
      if (r.value) getBody(bot, r.value)
      if (r.old) getBody(bot, r.old)
    })
  }

  const timeLeft = bot.env.getRemainingTime()
  await streamProcessor.processBatch({
    batch: records,
    worker: async (event: IStreamRecord) => {
      event = await preProcessItem(bot, event)
      if (isMessageRecord(event)) {
        await processMessageEvent(bot, event)
      } else {
        await processResourceChangeEvent(bot, event)
      }
    },
    perItemTimeout: SAFETY_MARGIN_MILLIS,
    timeout: Math.max(timeLeft - 1000, 0)
  })
}

const isMessageRecord = (r: IStreamRecord) => r.value && r.value[TYPE] === 'tradle.Message'

// const getLaneId = (record: IStreamRecord) => {
//   const parts = []
//   const category = Events.getEventCategory(record)
//   parts.push(category)

//   if (category === 'message') {
//     parts.push(record.value._dcounterparty)
//   }

//   // Q: do we want to process payloads before/after the messages that carry them?

//   return parts.join(':')
// }
