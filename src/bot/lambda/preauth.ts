import cors = require('kcors')
import compose = require('koa-compose')
import { bodyParser } from '../middleware/body-parser'
import { post } from '../middleware/noop-route'
import { EventSource, Lambda } from '../../lambda'
import { getRequestIps } from '../../utils'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.HTTP,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
  const { tradle, bot } = lambda
  const { auth, serviceMap } = tradle
  return compose([
    cors(),
    bodyParser(),
    async (ctx, next) => {
      const ips = getRequestIps(ctx.request)
      const { clientId, identity } = ctx.event
      ctx.session = await auth.createSession({ clientId, identity, ips })
      await next()
      if (!ctx.body) ctx.body = ctx.session
    },
    post('/preauth')
  ])
}
