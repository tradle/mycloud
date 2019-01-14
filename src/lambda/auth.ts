import compose from 'koa-compose'
import cors from 'kcors'
import Errors from '../errors'
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { MiddlewareHttp } from '../types'

export const createMiddleware = () => compose([
  post(),
  cors(),
  bodyParser(),
  auth()
])

export const auth = ():MiddlewareHttp => async (ctx, next) => {
  const { bot } = ctx.components
  const { env, logger, serviceMap, auth } = bot
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

  let {
    session,
    role=serviceMap.Role.IotClient,
  } = ctx

  if (!role.startsWith('arn:')) {
    role = `arn:aws:iam::${env.AWS_ACCOUNT_ID}:role/${role}`
  }

  const credentials = await auth.createCredentials(session, role)
  ctx.body = {
    time,
    position: session.serverPosition,
    ...credentials
  }
}
