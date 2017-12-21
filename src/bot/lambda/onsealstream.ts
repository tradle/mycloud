import { getRecordsFromEvent } from '../../db-utils'
import { batchProcess } from '../../utils'
import { Lambda, fromDynamoDB } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  const { batchSize=10 } = opts
  const processOne = async (record) => {
    let sealEvent
    // when a seal is queued for a write, unsealed is set to 'y'
    // when a seal is written, unsealed is set to null
    const wasJustSealed = (!record.old || record.old.unsealed) && !record.new.unsealed
    if (wasJustSealed) {
      sealEvent = 'wroteseal'
    } else {
      // do we care about distinguishing between # of confirmations
      // in terms of the event type?
      sealEvent = 'readseal'
    }

    await bot.hooks.fire(sealEvent, record.new)
  }

  return async (ctx, next) => {
    const { event } = ctx
    const records = getRecordsFromEvent(event, true) // new + old image
    await batchProcess({
      data: records,
      batchSize,
      processOne
    })

    await next()
  }
}
