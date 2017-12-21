import { Lambda, fromSchedule } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot, tradle } = lambda
  const { seals } = tradle
  return async (ctx, next) => {
    ctx.seals = await seals.syncUnconfirmed()
    // bot 'onwroteseal' hook is triggered in onsealstream
    await next()
  }
}
