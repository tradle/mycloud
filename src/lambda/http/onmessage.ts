import Router = require('koa-router')
import cors = require('kcors')
import bodyParser = require('koa-body')
import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

const messageHandler = async (ctx) => {
  const { message } = ctx.event
  // the user sent us a message
  const result = await user.onSentMessage({ message })
  if (result) {
    ctx.body = result
  }

  ctx.status = 200
}

const { user, logger } = tradle
const router = new Router()
router.use(cors())
router.use(bodyParser({ jsonLimit: '10mb' }))
router.post('/message', messageHandler)
router.put('/message', messageHandler)

lambda.use(router.routes())

if (lambda.env.INVOKE_BOT_LAMBDAS_DIRECTLY) {
  lambda.tradle.lambdaUtils.requireLambdaByName('bot_onmessage')
}

export const handler = lambda.handler
