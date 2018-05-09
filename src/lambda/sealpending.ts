import { Lambda } from '../types'
import { fromSchedule } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { seals } = lambda.bot
  return async (ctx, next) => {
    ctx.seals = await seals.sealPending()
    // bot 'onwroteseal' hook is triggered in onsealstream
    await next()
  }
}
