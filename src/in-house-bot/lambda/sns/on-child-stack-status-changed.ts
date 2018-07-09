import { createBot } from '../../../'
import { fromSNS } from '../../lambda'
import * as LambdaEvents from '../../lambda-events'
import { parseStackStatusEvent } from '../../../utils'
import Errors from '../../../errors'
import {
  IPBMiddlewareContext
} from '../../types'

const bot = createBot()
const lambda = fromSNS({ bot, event: LambdaEvents.CHILD_STACK_STATUS_CHANGED })
lambda.use(async (ctx:IPBMiddlewareContext) => {
  const { event, components } = ctx
  const { deployment, logger } = components

  let parsed
  try {
    parsed = parseStackStatusEvent(event)
  } catch (err) {
    lambda.logger.error('received invalid stack status event', event)
    return
  }

  logger.debug('received stack status event', event)

  try {
    await deployment.setChildStackStatus(parsed)
  } catch (err) {
    Errors.ignoreNotFound(err)
  }
})

export const handler = lambda.handler
