import compose from 'koa-compose'
import cors from 'kcors'
import { extend } from 'lodash'
import { get } from '../middleware/noop-route'
import { Lambda } from '../../types'
import { EventSource, fromHTTP } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot, logger } = lambda

  return compose([
    get(),
    cors(),
    async (ctx:any, next) => {
      logger.debug('setting bot endpoint info')
      if (!ctx.body) ctx.body = {}
      const { version, ...connectEndpoint } = await bot.getEndpointInfo()
      extend(ctx.body, { connectEndpoint, version })
      await next()
    }
  ])
}
