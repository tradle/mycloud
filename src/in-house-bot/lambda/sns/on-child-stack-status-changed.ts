import { fromSNS } from '../../lambda'
import * as LambdaEvents from '../../lambda-events'
import { parseStackStatusEvent } from '../../../utils'
import {
  IPBMiddlewareContext,
  StackStatusEvent,
} from '../../types'

const lambda = fromSNS({ event: LambdaEvents.CHILD_STACK_STATUS_CHANGED })
lambda.use(async (ctx:IPBMiddlewareContext) => {
  const { event, components } = ctx
  const { deployment, logger } = components

  let parsed:StackStatusEvent
  try {
    parsed = parseStackStatusEvent(event)
  } catch (err) {
    lambda.logger.error('received invalid stack status event', event)
    return
  }

  logger.debug('received stack status event', event)
  await deployment.handleChildStackStatusEvent(parsed)
})

export const handler = lambda.handler
