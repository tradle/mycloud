import compose = require('koa-compose')
import cors = require('kcors')
import Errors from '../../errors'
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
    try {
      ctx.session = await tradle.auth.handleChallengeResponse(ctx.request.body)
    } catch (err) {
      Errors.rethrow(err, 'system')
      ctx.status = 400
      if (Errors.matches(err, Errors.HandshakeFailed)) {
        ctx.body = {
          message: err.message
        }
      } else {
        ctx.body = {
          message: 'failed, please retry'
        }
      }

      return
    }

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
