import { Lambda, EventSource } from '../lambda'
import { tradle } from '../'

const lambda = new Lambda({ source: EventSource.SCHEDULE, tradle })
const { seals } = tradle
lambda.use(async (ctx) => {
  ctx.body = await seals.sealPending()
})

export const handler = lambda.handler
