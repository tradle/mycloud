import { EventSource } from '../../../lambda'
import cors = require('kcors')
import { createBot } from '../../../bot'
import { customize } from '../../customize'

const bot = createBot({ ready: false })
const lambda = bot.createLambda({ source: EventSource.HTTP })
const promiseCustomize = customize({ lambda, event: 'onfido:webhook' })
lambda.tasks.add({
  name: 'init',
  promise: promiseCustomize
})

lambda.use(cors())
lambda.use(async (ctx) => {
  const { onfidoPlugin } = await promiseCustomize
  await onfidoPlugin.processWebhookEvent({
    req: ctx.request,
    res: ctx.response
  })
})

export const handler = lambda.handler
