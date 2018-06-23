import { Lambda } from '../types'
import { fromSchedule } from '../lambda'

const SAFETY_MARGIN_MILLIS = 20000

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { seals, env, logger } = lambda.bot
  return async (ctx, next) => {
    let results = []
    let error
    let batch
    let haveTime
    do {
      batch = await seals.sealPending({ limit: 10 })
      results = results.concat(batch.seals)
      error = batch.error
      haveTime = env.getRemainingTime() > SAFETY_MARGIN_MILLIS
    } while (haveTime && !error && batch.seals.length)

    if (!haveTime) {
      logger.debug('almost out of time, exiting early')
    }

    ctx.seals = results
    await next()
  }
}
