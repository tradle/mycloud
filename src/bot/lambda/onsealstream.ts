import _ from 'lodash'
import compose from 'koa-compose'
import { getRecordsFromEvent } from '../../db-utils'
import { batchProcess } from '../../utils'
import { Lambda } from '../../types'
import { fromDynamoDB } from '../lambda'
import { createMiddleware as createSaveEvents } from '../middleware/events'
import { getSealEventTopic } from '../../events'
const toBatchEvent = event => event + ':batch'
const pluckData = ({ data }) => data

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot, tradle } = lambda
  const { batchSize=10 } = opts
  const processBatch = async (records) => {
    const events = records.map(recordToEvent)
    const byType = _.groupBy(events, 'event')

    // trigger batch processors
    await Promise.all(Object.keys(byType).map(async (event) => {
      const subset = byType[event]
      if (subset) {
        await bot.fire(toBatchEvent(event), subset.map(pluckData))
      }
    }))

    // trigger per-seal-event processors
    await Promise.all(events.map(({ event, data }) => {
      return bot.fire(event, data)
    }))
  }

  const saveEvents = createSaveEvents(tradle.events)
  const processStream = async (ctx, next) => {
    const data = getRecordsFromEvent(ctx.event).filter(record => record.new)
    await batchProcess({ data, batchSize, processBatch })
    await next()
  }

  return compose([
    saveEvents,
    processStream
  ])
}

const recordToEvent = record => ({
  event: getSealEventTopic(record),
  data: record.new
})
