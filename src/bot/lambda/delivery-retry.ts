// @ts-ignore
import Promise from 'bluebird'
import { chunk } from 'lodash'
import { TYPE } from '@tradle/constants'
import { Lambda, Bot } from '../../types'
import { fromSchedule } from '../lambda'
import { TYPES } from '../../constants'

const { DELIVERY_ERROR } = TYPES
const BATCH_SIZE = 10

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  const { bot, logger } = lambda
  return lambda.use(createMiddleware(lambda.bot, opts))
}

export const createMiddleware = (bot: Bot, opts?: any) => {
  const { db, logger, events } = bot
  const { topics } = events
  return async (ctx, next) => {
    const failed = await db.find({
      filter: {
        EQ: {
          [TYPE]: DELIVERY_ERROR
        }
      }
    })

    if (!failed.length) {
      await next()
      return
    }

    await bot._fireDeliveryErrorBatchEvent({
      errors: failed,
      async: true,
    })

    await next()
  }
}
