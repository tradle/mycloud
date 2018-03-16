// @ts-ignore
import Promise from 'bluebird'
import { Lambda } from '../../types'
import { topics as EventTopics, toBatchEvent } from '../../events'
import { EventSource, fromDynamoDB } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  return async (ctx, next) => {
    const partials = bot.dbUtils.getRecordsFromEvent(ctx.event)
      .map(record => record.new)
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
      .filter(partial => partial)

    const objects = await Promise.all(partials.map(({ _link }) => bot.objects.get(_link)))
    // match the sync event format
    await bot._fireSaveBatchEvent({ objects, async: true })
  }
}
