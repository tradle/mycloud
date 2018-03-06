import _ = require('lodash')
import { getRecordsFromEvent } from '../../db-utils'
import { batchProcess } from '../../utils'
import { Lambda } from '../../types'
import { fromDynamoDB } from '../lambda'

const Watch = {
  one: 'watchseal',
  batch: 'watchseals'
}

const QueueWrite = {
  one: 'queueseal',
  batch: 'queueseals'
}

const Read = {
  one: 'readseal',
  batch: 'readseals'
}

const Write = {
  one: 'wroteseal',
  batch: 'wroteseals'
}

const toBatchEvent = event => event + 's'
const pluckData = ({ data }) => data

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  const { batchSize=10 } = opts
  const processBatch = async (records) => {
    const events = records.map(recordToEvent)
    const byType = _.groupBy(events, 'event')

    // trigger batch processors
    await Promise.all(Object.keys(byType).map(async (event) => {
      const subset = byType[event]
      if (subset) {
        await bot.hooks.fire(toBatchEvent(event), subset.map(pluckData))
      }
    }))

    // trigger per-seal-event processors
    await Promise.all(events.map(({ event, data }) => {
      return bot.hooks.fire(event, data)
    }))
  }

  return async (ctx, next) => {
    const data = getRecordsFromEvent(ctx.event, true) // new + old image
    await batchProcess({ data, batchSize, processBatch })
    await next()
  }
}

const recordToEvent = record => ({
  event: recordToEventType(record),
  data: record.new
})

const recordToEventType = record => {
  // when a seal is queued for a write, unsealed is set to 'y'
  // when a seal is written, unsealed is set to null
  const wasJustSealed = record.old && record.old.unsealed && !record.new.unsealed
  if (wasJustSealed) return Write.one
  if (record.new.unsealed) return QueueWrite.one

  // do we care about distinguishing between # of confirmations
  // in terms of the event type?
  if (!record.old && record.new.unconfirmed && !record.new.unsealed) {
    return Watch.one
  }

  return Read.one
}

const splitReadWrite = events => _.partition(
  events,
  ({ event }) => event === Read.one
)
