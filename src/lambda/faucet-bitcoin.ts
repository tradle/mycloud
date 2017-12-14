import { Lambda, EventSource } from '../lambda'
import { tradle } from '../'

const { faucet } = tradle
const lambda = new Lambda({ source: EventSource.SCHEDULE, tradle })
lambda.use(async (ctx) => {
  const { to, fee } = ctx.event
  const total = to.reduce((total, next) => total + next.amount, 0)
  if (total > 1e7) {
    throw new Error('the limit per withdrawal is 0.1 bitcoin')
  }

  ctx.body = await faucet.withdraw({ to, fee })
})

export const handler = lambda.handler
