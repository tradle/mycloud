import cors from 'kcors'
import compose from 'koa-compose'
import { post } from '../middleware/noop-route'
import { bodyParser } from '../middleware/body-parser'
import { Lambda } from '../types'
import { fromHTTP } from '../lambda'
import { getRequestIps } from '../utils'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  const { auth, serviceMap } = bot
  return compose([
    post(),
    cors(),
    bodyParser(),
    async (ctx:any, next) => {
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
