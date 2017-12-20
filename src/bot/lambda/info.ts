import compose = require('koa-compose')
import cors = require('kcors')
import { EventSource } from '../../lambda'
import { get } from '../middleware/noop-route'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.HTTP,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
  const { bot, logger } = lambda

  return compose([
    cors(),
    async (ctx, next) => {
      logger.debug('setting bot endpoint info')
      if (!ctx.body) ctx.body = {}
      Object.assign(ctx.body, bot.endpointInfo)
      await next()
    },
    get('/info')
  ])
}
