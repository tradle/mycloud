import compose from 'koa-compose'
import cors from 'kcors'
import { createBot } from '../../../'
import { configureLambda } from '../..'
import { post } from '../../../middleware/noop-route'
import Errors from '../../../errors'
import * as LambdaEvents from '../../lambda-events'
import { fromHTTP } from '../../lambda'

const lambda = fromHTTP({
  event: LambdaEvents.ONFIDO_PROCESS_WEBHOOK_EVENT,
  preware: compose([
    post(),
    cors(),
  ])
})

lambda.use(async (ctx) => {
  const { onfido } = ctx.components
  if (!onfido) {
    throw new Errors.HttpError(404, 'not found')
  }

  await onfido.processWebhookEvent({
    req: ctx.request.req
  })
})

export const handler = lambda.handler
