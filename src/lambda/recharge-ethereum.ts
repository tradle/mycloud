import { Lambda, EventSource } from '../lambda'
import { tradle } from '../'

const { blockchain } = tradle
const lambda = new Lambda({ source: EventSource.SCHEDULE, tradle })
lambda.use(async (ctx) => {
  ctx.body = await blockchain.recharge()
})

export const handler = lambda.handler
