import { EventSource } from '../../../lambda'
import cors from 'kcors'
import { createBot } from '../../../bot'
import { customize } from '../../customize'
import { post } from '../../../bot/middleware/noop-route'
import Errors from '../../../errors'

const bot = createBot({ ready: false })
const lambda = bot.createLambda({ source: EventSource.HTTP })
const promiseCustomize = customize({ lambda, event: 'onfido:webhook' })

lambda.use(post())
lambda.use(cors())
lambda.use(async (ctx) => {
  const { onfido } = await promiseCustomize
  if (!onfido) {
    throw new Errors.HttpError(404, 'not found')
  }

  await onfido.processWebhookEvent({
    req: ctx.request.req
  })
})

export const handler = lambda.handler
