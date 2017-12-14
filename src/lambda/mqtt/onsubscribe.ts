import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

lambda.use(async ({ event, context }) => {
  const { clientId, topics } = event
  await tradle.user.onSubscribed({ clientId, topics })
})

export const handler = lambda.handler
