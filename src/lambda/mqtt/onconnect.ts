import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

lambda.use(async ({ event, context }) => {
  lambda.logger.debug('client connected', event)
  const { clientId } = event
  await tradle.user.onConnected({ clientId })
})

export const handler = lambda.handler
