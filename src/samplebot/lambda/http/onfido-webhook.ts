import { EventSource } from '../../../lambda'
import cors = require('kcors')
import { createBot } from '../../../bot'
import { customize } from '../../customize'
import { post } from '../../../bot/middleware/noop-route'
import Errors = require('../../../errors')

const bot = createBot({ ready: false })
const lambda = bot.createLambda({ source: EventSource.HTTP })
const promiseCustomize = customize({ lambda, event: 'onfido:webhook' })

lambda.use(post())
lambda.use(cors())
lambda.use(async (ctx) => {
  const { onfidoPlugin } = await promiseCustomize
  if (!onfidoPlugin) {
    throw new Errors.HttpError(404, 'not found')
  }

  await onfidoPlugin.processWebhookEvent({
    req: ctx.request.req
  })
})

export const handler = lambda.handler
