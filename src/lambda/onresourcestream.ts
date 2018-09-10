// @ts-ignore
import Promise from 'bluebird'
import omit from 'lodash/omit'
import groupBy from 'lodash/groupBy'
import { TYPE } from '@tradle/constants'
import { Bot, IStreamRecord, ITradleObject, Model, DB } from '../types'
import { fromDynamoDB } from '../lambda'
// import { createMiddleware as createMessageMiddleware } from '../middleware/onmessagestream'
import Errors from '../errors'
import Events from '../events'

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

export const stripTableSchemaProps = (db: DB, model:Model, item: ITradleObject) => {
  if (!model) return item

  const table = db.getTableForModel(model)
  if (!table) return item

  return omit(item, table.keyProps)
}

const getBody = async (bot: Bot, item: any) => {
  const clean = item => stripTableSchemaProps(bot.db, item[TYPE] && bot.models[item[TYPE]], item)

  item = clean(item)
  if (!item._link) return item

  if (item[TYPE] === 'tradle.Message') {
    return {
      ...item,
      object: clean({
        ...item.object,
        ...(await getBody(bot, item.object))
      })
    }
  }

  const body = await bot.objects.getWithRetry(item._link, {
    logger: bot.logger,
    maxAttempts: 10,
    maxDelay: 2000,
    timeout: bot.env.getRemainingTimeWithBuffer(5000),
    initialDelay: 500,
    shouldTryAgain: err => {
      const willRetry = Errors.isNotFound(err)
      bot.logger.error(`can't find object with link ${item._link}`, {
        error: Errors.export(err),
        willRetry,
      })

      bot.logger.silly(`can't find object in object storage`, item)

      Errors.rethrow(err, 'developer')

      if (item._time) {
        const age = Date.now() - item._time
        if (age > GIVE_UP_AGE) {
          throw new Errors.GaveUp(`gave up on looking up object ${item._link} age ${age}ms`)
        }
      }

      return Errors.isNotFound(err)
    }
  })

  return clean(body)
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

  const byCat = groupBy(records, Events.getEventCategory)
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
