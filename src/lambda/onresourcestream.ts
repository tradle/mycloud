// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Lambda, Bot, IRetryableTaskOpts, IStreamRecord } from '../types'
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

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  const { bot } = lambda

  // bot.hook(EventTopics.message.stream.async.batch, createMessageMiddleware(bot, opts))
  // bot.hook(EventTopics.message.stream.async, onMessagesSaved(bot, { async: true }))

  return lambda.use(createMiddleware(bot))
}

// export const processMessages = async (bot: Bot, messages) => {
//   bot.logger.debug(`processing ${messages.length} messages from stream`)
//   await bot.fireBatch(EventTopics.message.stream.async, messages)
// }

export const processMessage = async (bot: Bot, message) => {
  // onMessagesSaved(bot, { async })
  await bot.fire(EventTopics.message.stream.async, message)
}

// export const processResources = async (bot: Bot, resources) => {
//   bot.logger.debug(`processing ${resources.length} resource changes from stream`)
//   const changes = await Promise.map(resources, async (r) => {
//     try {
//       return await preProcessResourceRecord(bot, r)
//     } catch (err) {
//       Errors.ignore(err, Errors.GaveUp)
//     }
//   })
//   .then(results => results.filter(_.identity))

//   await bot._fireSaveBatchEvent({ changes, async: true, spread: true })
// }

export const processResourceChange = async (bot: Bot, change) => {
  await preProcessResourceRecord(bot, change)
  await bot._fireSaveEvent({ change, async: true })
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

export const createMiddleware = (bot:Bot) => {
  const { dbUtils, streamProcessor } = bot
  return async (ctx, next) => {
    await processRecords({
      bot,
      records: dbUtils.getRecordsFromEvent(ctx.event)
    })
  }
}

export const processRecords = async ({ bot, records }: {
  bot: Bot
  records: IStreamRecord[]
}) => {
  const { dbUtils, streamProcessor } = bot
  records.forEach(record => {
    // @ts-ignore
    record.laneId = getLaneId(record)
  })

  const byCat = _.groupBy(records, Events.getEventCategory)
  if (byCat.resource) {
    byCat.resource.forEach(r => {
      // prime cache
      if (r.new) getBody(bot, r.new)
      if (r.old) getBody(bot, r.old)
    })
  }

  // if (bot.isTesting && byCat.message) {
  //   await bot.fireBatch(EventTopics.message.stream.async.batch, pluck(byCat.message, 'new'))
  // }

  await streamProcessor.processBatch({
    batch: records,
    processOne: async (event) => {
      if (isMessageRecord(event)) {
        await processMessage(bot, event.new)
      } else {
        await processResourceChange(bot, event)
      }
    }
  })
}

const isMessageRecord = r => r.new && r.new[TYPE] === 'tradle.Message'

const getLaneId = (record: IStreamRecord) => {
  const parts = []
  const category = Events.getEventCategory(record)
  parts.push(category)

  if (category === 'message') {
    parts.push(record.new._dcounterparty)
  }

  // Q: do we want to process payloads before/after the messages that carry them?

  return parts.join(':')
}
