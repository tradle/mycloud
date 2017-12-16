import Router = require('koa-router')
import cors = require('kcors')
import bodyParser = require('koa-body')
import { tradle } from '../../'
import Errors = require('../../errors')
import { getRequestIps } from '../../utils'
import { Lambda, EventSource } from '../../lambda'

const { user, logger } = tradle
const inboxHandler = async (ctx) => {
  const { messages } = ctx.request.body
  logger.debug(`receiving ${messages.length} messages in inbox`)
  for (const message of messages) {
    await user.onSentMessage({ message })
  }

  logger.debug(`received ${messages.length} messages in inbox`)
  // i don't think API Gateway likes non-json responses
  // it lets them through but Content-Type ends up as application/json
  // and clients fail on trying to parse an empty string as json
  ctx.body = {}
}

const lambda = new Lambda({
  source: EventSource.HTTP,
  tradle
})

lambda.tasks.add({
  name: 'getiotendpoint',
  promiser: tradle.iot.getEndpoint
})

lambda.use(cors())
lambda.use(bodyParser({ jsonLimit: '10mb' }))

const router = new Router()
router.put('/inbox', inboxHandler)
router.post('/inbox', inboxHandler)
lambda.use(router.routes())

export const handler = lambda.handler
