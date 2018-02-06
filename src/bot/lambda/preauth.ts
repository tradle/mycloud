import cors = require('kcors')
import compose = require('koa-compose')
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { Lambda } from '../../types'
import { fromHTTP } from '../lambda'
import { getRequestIps } from '../../utils'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { tradle, bot } = lambda
  const { auth, serviceMap } = tradle
  return compose([
    post(),
    cors(),
    bodyParser(),
    async (ctx:any, next) => {
      const ips = getRequestIps(ctx.request)
      const { clientId, identity } = ctx.event
      ctx.session = await auth.createSession({ clientId, identity, ips })
      await next()
      if (!ctx.body) ctx.body = ctx.session
    }
  ])
}
