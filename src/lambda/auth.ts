import compose from 'koa-compose'
import cors from 'kcors'
import Errors from '../errors'
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { LambdaHttp as Lambda } from '../types'
import { fromHTTP } from '../lambda'

export const createMiddleware = (lambda:Lambda) => {
  return compose([
    post(),
    cors(),
    bodyParser(),
    auth(lambda)
  ])
}

export const auth = (lambda:Lambda) => {
  return async (ctx, next) => {
    const { bot, logger } = ctx.components
    const { auth } = bot
    const time = Date.now()
    try {
      ctx.session = await auth.handleChallengeResponse(ctx.request.body)
    } catch (err) {
      logger.error('auth failed', err)
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
    await bot.fire('user:authenticated', ctx.userId)
    await next()
    if (ctx.body) {
       // allow full customization of authentication
      return
    }

    const {
      session,
      role=bot.serviceMap.Role.IotClient
    } = ctx

    const credentials = await bot.auth.createCredentials(session, role)
    ctx.body = {
      time,
      position: session.serverPosition,
      ...credentials
    }
  }
}
