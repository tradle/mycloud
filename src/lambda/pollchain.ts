import { tradle } from '../'
import { Lambda, EventSource } from '../lambda'

const { seals } = tradle
const lambda = new Lambda({ source: EventSource.SCHEDULE, tradle })

lambda.use(async ({ event, context }) => {
  await seals.syncUnconfirmed()
})

export const handler = lambda.handler

