import compose from 'koa-compose'
import cors from 'kcors'
import { clone, extend, pick } from 'lodash'
import { version as protocolVersion } from '@tradle/protocol'
import { get } from '../middleware/noop-route'
import { Lambda, MiddlewareHttp } from '../types'
import Errors from '../errors'

const info = (): MiddlewareHttp => async (ctx, next) => {
  const { bot } = ctx.components
  const { logger } = bot
  logger.debug('setting bot endpoint info')
  if (!ctx.body) ctx.body = {}

  const chainKey = await bot.identity.getChainKeyPub().catch(Errors.ignoreNotFound)
  const { version, ...connectEndpoint } = clone(bot.endpointInfo)
  // @ts-ignore
  version.protocol = protocolVersion
  extend(ctx.body, {
    connectEndpoint,
    version
  })

  if (chainKey) {
    ctx.body.chainKey = pick(chainKey, ['type', 'pub', 'fingerprint', 'networkName'])
  }

  await next()
}

export const createMiddleware = () => compose([get(), cors(), info()])
