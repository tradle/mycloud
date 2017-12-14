import Router = require('koa-router')
import cors = require('kcors')
import bodyParser = require('koa-body')
import { tradle } from '../../'
import { getRequestIps } from '../../utils'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.HTTP,
  tradle
})

const router = new Router()
router.post('/preauth', async (ctx) => {
  // debug('[START]', now)
  const ips = getRequestIps(ctx.request)
  const { clientId, identity } = ctx.request.body
  const { accountId } = ctx.event.requestContext
  const session = await tradle.user.onPreAuth({ accountId, clientId, identity, ips })
  ctx.body = session
})

lambda.use(cors())
lambda.use(bodyParser())
lambda.use(router.routes())

export const handler = lambda.handler
