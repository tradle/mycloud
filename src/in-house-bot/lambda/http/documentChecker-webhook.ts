import compose from 'koa-compose'
import cors from 'kcors'
import { configureLambda } from '../..'
import { post } from '../../../middleware/noop-route'
import { bodyParser } from '../../../middleware/body-parser'
import Errors from '../../../errors'
import * as LambdaEvents from '../../lambda-events'
import { fromHTTP } from '../../lambda'

const lambda = fromHTTP({
  event: LambdaEvents.DOCUMENT_CHECKER_WEBHOOK_EVENT,
  preware: compose([
    post(),
    cors(),
    bodyParser(),
  ])
})

lambda.use(async (ctx) => {
  // debugger
  const { documentChecker } = ctx.components
  if (!documentChecker) {
    throw new Errors.HttpError(404, 'not found')
  }

  try {
    await documentChecker.handleVerificationEvent(ctx.event)
  } catch (err) {
    debugger
    // lambda.logger.error('failed to handle documentChecker webhook call', err)
    ctx.body = `failed to handle documentChecker webhook call: ${err.name}`
    ctx.status = 500
    ctx.error = new Error('failed')
  }
})

export const handler = lambda.handler
