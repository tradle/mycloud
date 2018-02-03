import _ = require('lodash')
import { getRecordsFromEvent } from '../../db-utils'
import { batchProcess } from '../../utils'
import { Lambda, fromDynamoDB } from '../lambda'

const Read = {
  one: 'readseal',
  batch: 'readseals'
}

const Write = {
  one: 'wroteseal',
  batch: 'wroteseals'
}

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  const { batchSize=10 } = opts
  const processBatch = async (records) => {
    const events = records.map(recordToEvent)
    const [read, wrote] = splitReadWrite(events)
    // trigger batch processors
    await Promise.all([
      read.map(({ data }) => bot.hooks.fire(Read.batch, data)),
      wrote.map(({ data }) => bot.hooks.fire(Write.batch, data))
    ])

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
  const wasJustSealed = (!record.old || record.old.unsealed) && !record.new.unsealed
  if (wasJustSealed) return Write.one

  // do we care about distinguishing between # of confirmations
  // in terms of the event type?
  return Read.one
}

const splitReadWrite = events => _.partition(
  events,
  ({ event }) => event === Read.one
)
