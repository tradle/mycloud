import compose = require('koa-compose')
import cors = require('kcors')
import { EventSource, Lambda, fromHTTP } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot, logger } = lambda

  return compose([
    cors(),
    async (ctx, next) => {
      logger.debug('setting bot endpoint info')
      if (!ctx.body) ctx.body = {}
      Object.assign(ctx.body, bot.endpointInfo)
      await next()
    }
  ])
}
