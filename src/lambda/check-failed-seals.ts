import { tradle } from '../'
import { Lambda, EventSource } from '../lambda'

const { seals } = tradle
const lambda = new Lambda({ source: EventSource.SCHEDULE, tradle })
const SIX_HOURS = 6 * 3600 * 1000

lambda.use(async ({ event, context }) => {
  await seals.handleFailures({ gracePeriod: SIX_HOURS })
})

export const handler = lambda.handler
