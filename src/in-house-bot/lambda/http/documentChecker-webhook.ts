import { EventSource } from '../../../lambda'
import cors from 'kcors'
import { createBot } from '../../../'
import { configureLambda } from '../..'
import { post } from '../../../middleware/noop-route'
import Errors from '../../../errors'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.createLambda({ source: EventSource.HTTP })
const promiseComponents = configureLambda({ lambda, event: LambdaEvents.DOCUMENT_CHECKER_WEBHOOK_EVENT })

lambda.use(post())
lambda.use(cors())
lambda.use(async (ctx) => {
  const { documentChecker } = await promiseComponents
  if (!documentChecker) {
    throw new Errors.HttpError(404, 'not found')
  }

  const { event } = ctx
  try {
    // await documentChecker.handleVerificationEvent(event)
  } catch (err) {
    lambda.logger.error('failed to handle documentChecker webhook call', err)
    ctx.status = 500
    ctx.error = new Error('failed')
  }
})

export const handler = lambda.handler
