import { EventSource } from '../../../lambda'
import Router = require('koa-router')
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

const onfidoRouter = new Router()
onfidoRouter.use(cors())
onfidoRouter.post('/onfido', async (ctx) => {
  const { onfidoPlugin } = await promiseCustomize
  await onfidoPlugin.processWebhookEvent({
    req: ctx.req,
    res: ctx.res
  })
})

lambda.use(onfidoRouter.routes())

export const handler = lambda.handler
