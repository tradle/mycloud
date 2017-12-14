import { EventSource } from '../../lambda'

export const createLambda = (opts) => {
  return outfitLambda(opts.bot.createLambda({
    source: EventSource.HTTP,
    ...opts
  }), opts)
}

export const outfitLambda = (lambda, opts) => {
  const { bot, logger } = lambda
  lambda.use(async (ctx, next) => {
    logger.debug('setting bot endpoint info')
    if (!ctx.body) ctx.body = {}
    Object.assign(ctx.body, bot.endpointInfo)
    await next()
  })

  return lambda
}
