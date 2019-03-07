import compose from 'koa-compose'
import cors from 'kcors'
import { clone, extend, pick } from 'lodash'
import { version as protocolVersion } from '@tradle/protocol'
import { get } from '../middleware/noop-route'
import { Lambda } from '../types'
import { fromHTTP } from '../lambda'
import Errors from '../errors'

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

      const chainKey = await bot.identity.getChainKeyPub().catch(Errors.ignoreNotFound)
      const { version, ...connectEndpoint } = clone(bot.endpointInfo)
      // @ts-ignore
      version.protocol = protocolVersion
      extend(ctx.body, {
        connectEndpoint,
        version,
      })

      if (chainKey) {
        ctx.body.chainKey = pick(chainKey, ['type', 'pub', 'fingerprint', 'networkName'])
      }

      await next()
    }
  ])
}
