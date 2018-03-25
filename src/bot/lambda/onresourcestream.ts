// @ts-ignore
import Promise from 'bluebird'
import { Lambda } from '../../types'
import { topics as EventTopics, toBatchEvent } from '../../events'
import { EventSource, fromDynamoDB } from '../lambda'

const promiseUndefined = Promise.resolve(undefined)

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  return async (ctx, next) => {
    const records = bot.dbUtils.getRecordsFromEvent(ctx.event)
      // .map(record => record.new)
      // .map(record => {
      //   if (record.new) {
      //     if (record.old) {
      //       return {
      //         type: 'update',
      //         previous: record.new,
      //         current: record.old
      //       }
      //     }
      //   }
      // })
      // .filter(partial => partial)

    const changes = await Promise.all(records.map(async (record) => {
      const [value, old] = await Promise.all([
        record.new ? bot.objects.get(record.new._link) : promiseUndefined,
        record.old ? bot.objects.get(record.old._link) : promiseUndefined
      ])

      return { value, old }
    }))

    // match the sync event format
    await bot._fireSaveBatchEvent({ changes, async: true })
  }
}
