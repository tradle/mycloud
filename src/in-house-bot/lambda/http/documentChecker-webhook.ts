import compose from 'koa-compose'
import cors from 'kcors'
import { configureLambda } from '../..'
import { post } from '../../../middleware/noop-route'
import Errors from '../../../errors'
import * as LambdaEvents from '../../lambda-events'
import { fromHTTP } from '../../lambda'

const lambda = fromHTTP({
  event: LambdaEvents.DOCUMENT_CHECKER_WEBHOOK_EVENT,
  preware: compose([
    post(),
    cors(),
  ])
})

lambda.use(async (ctx) => {
  debugger
  const { documentChecker } = ctx.components
  if (!documentChecker) {
    throw new Errors.HttpError(404, 'not found')
  }

  const { body } = ctx.event
  let evt = JSON.parse(body.toString())

  try {
    await documentChecker.handleVerificationEvent(evt)
  } catch (err) {
    debugger
    // lambda.logger.error('failed to handle documentChecker webhook call', err)
    ctx.body = `failed to handle documentChecker webhook call: ${err.name}`
    ctx.status = 500
    ctx.error = new Error('failed')
  }
})

export const handler = lambda.handler
