import compose = require('koa-compose')
import cors = require('kcors')
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { EventSource, Lambda } from '../../lambda'

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
      const time = Date.now()
      ctx.session = await auth.handleChallengeResponse(ctx.request.body)
      ctx.userId = ctx.session.permalink
      await next()
      if (ctx.body) {
         // allow full customization of authentication
        return
      }

      const {
        session,
        role=serviceMap.Role.IotClient
      } = ctx

      const credentials = await auth.createCredentials(session, role)
      ctx.body = {
        time,
        position: session.serverPosition,
        ...credentials
      }
    },
    post('/auth')
  ])
}
