import { TYPE } from '@tradle/constants'
import Errors = require('../../errors')
import { getRecordsFromEvent } from '../../db-utils'
import { getMessagePayload } from '../utils'
import { pick, batchProcess, ensureTimestamped, promiseNoop } from '../../utils'
import { savePayloadToDB } from '../utils'
import { Lambda, fromDynamoDB } from '../lambda'
import { onmessage as createOnMessageMiddleware } from '../middleware/onmessage'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot, logger } = lambda
  const logAndThrow = (results) => {
    const failed = results.map(({ reason }) => reason)
      .filter(reason => reason)

    if (failed.length) {
      logger.debug('failed to save payloads', failed)
      throw new Error(failed[0])
    }
  }

  return async (ctx, next) => {
    const { event } = ctx
    event.bot = bot
    // unmarshalling is prob a waste of time
    const messages = getRecordsFromEvent(event)
    ctx.results = await batchProcess({
      data: messages,
      batchSize: 20,
      processOne: async (message) => {
        const payload = message.object
        const type = message._payloadType
        try {
          await savePayloadToDB({ bot, message })
          logger.debug('saved', pick(payload, [TYPE, '_permalink']))
        } catch (err) {
          // TODO: to DLQ
          logger.debug('failed to put to db', {
            type,
            link: payload._link,
            error: err.stack
          })

          throw err
        }

        return message
      },
      settle: true
    })

    const successes = ctx.results
      .filter(result => result.value)
      .map(result => result.value)

    const middleware = createOnMessageMiddleware(lambda, opts)
    await batchProcess({
      data: successes,
      batchSize: 20,
      processOne: async (message) => {
        const subCtx = { ...lambda.execCtx, event: message }
        try {
          await middleware(subCtx, promiseNoop)
        } catch (err) {
          logger.debug('failure in custom onmessagestream middleware', {
            message: message,
            error: Errors.export(err)
          })
        }
      }
    })

    logAndThrow(ctx.results)
    await next()
  }
}
