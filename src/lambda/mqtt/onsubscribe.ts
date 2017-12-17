import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

lambda.tasks.add({
  name: 'getiotendpoint',
  promiser: lambda.tradle.iot.getEndpoint
})

lambda.use(async ({ event, context }) => {
  if (Buffer.isBuffer(event)) event = JSON.parse(event)

  const { clientId, topics } = event
  await tradle.user.onSubscribed({ clientId, topics })
})

export const handler = lambda.handler
