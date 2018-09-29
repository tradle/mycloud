import cors from 'kcors'
import compose from 'koa-compose'
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { Lambda, ILambdaExecutionContext } from '../types'
import { getRequestIps } from '../utils'

export const createMiddleware = (lambda:Lambda) => {
  return compose([
    post(),
    cors(),
    bodyParser(),
    async (ctx: ILambdaExecutionContext, next) => {
      const { bot } = ctx.components
      const { auth, serviceMap } = bot
      const ips = getRequestIps(ctx.request)
      const { clientId, identity } = ctx.event
      const getEndpoint = bot.getEndpointInfo()
      ctx.session = await auth.createSession({ clientId, identity, ips })
      ctx.session.connectEndpoint = await getEndpoint
      ctx.session.region = bot.env.AWS_REGION
      if (lambda.isEmulated) {
        ctx.session.s3Endpoint = bot.aws.s3.endpoint.host
      }

      await next()
      if (!ctx.body) ctx.body = ctx.session
    }
  ])
}
