import { tradle } from '../'
import { Lambda, EventSource } from '../lambda'

const { lambdaUtils } = tradle
const lambda = new Lambda({ tradle, source: EventSource.LAMBDA })

lambda.use(async (ctx) => {
  ctx.body = await lambdaUtils.warmUp(ctx.event)
})

export const handler = lambda.handler
