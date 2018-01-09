import compose = require('koa-compose')
import cors = require('kcors')
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { EventSource, Lambda, fromHTTP } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  return compose([
    post(),
    cors(),
    bodyParser(),
    auth(lambda, opts)
  ])
}

export const auth = (lambda:Lambda, opts?:any) => {
  const { tradle, bot } = lambda
  return async (ctx, next) => {
    const time = Date.now()
    ctx.session = await tradle.auth.handleChallengeResponse(ctx.request.body)
    ctx.userId = ctx.session.permalink
    await bot.hooks.fire('user:authenticated', ctx.userId)
    await next()
    if (ctx.body) {
       // allow full customization of authentication
      return
    }

    const {
      session,
      role=tradle.serviceMap.Role.IotClient
    } = ctx

    const credentials = await tradle.auth.createCredentials(session, role)
    ctx.body = {
      time,
      position: session.serverPosition,
      ...credentials
    }
  }
}
