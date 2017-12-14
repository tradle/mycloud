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
router.post('/auth', async (ctx) => {
  ctx.body = await tradle.user.onSentChallengeResponse(ctx.request.body)
})

lambda.use(cors())
lambda.use(bodyParser())
lambda.use(router.routes())

export const handler = lambda.handler
