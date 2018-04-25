import compose from 'koa-compose'
import cors from 'kcors'
import { extend } from 'lodash'
import { get } from '../middleware/noop-route'
import { Lambda } from '../../types'
import { getChainKey } from '../../crypto'
import { EventSource, fromHTTP } from '../lambda'
import Errors from '../../errors'

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

      const [chainKey, endpointInfo] = await Promise.all([
        bot.identity.getChainKeyPub().catch(Errors.ignoreNotFound),
        bot.getEndpointInfo()
      ])

      const { version, ...connectEndpoint } = endpointInfo
      extend(ctx.body, { connectEndpoint, version })
      if (chainKey) ctx.body.chainKey = chainKey
      await next()
    }
  ])
}
