import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

lambda.tasks.add({
  name: 'getiotendpoint',
  promiser: tradle.iot.getEndpoint
})

lambda.use(async ({ event, context }) => {
  lambda.logger.debug('client connected', event)
  const { clientId } = event
  await tradle.user.onConnected({ clientId })
})

export const handler = lambda.handler
