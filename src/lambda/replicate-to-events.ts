import { Lambda, EventSource } from '../lambda'
import { tradle } from '../'

const { events } = tradle
const lambda = new Lambda({ source: EventSource.DYNAMODB, tradle })
lambda.use(async ({ event }) => {
  const results = events.fromStreamEvent(event)
  if (results.length) {
    await events.putEvents(results)
  }
})

export const handler = lambda.handler
