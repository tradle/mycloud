import { EventSource } from '../../../lambda'
import cors from 'kcors'
import { createBot } from '../../../'
import { configureLambda } from '../..'
import { post } from '../../../middleware/noop-route'
import Errors from '../../../errors'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.createLambda({ source: EventSource.HTTP })
const promiseCustomize = configureLambda({ lambda, event: LambdaEvents.ONFIDO_PROCESS_WEBHOOK_EVENT })

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
