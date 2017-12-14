import { Init } from '../init'
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.oninit()
const init = new Init({ bot })

lambda.use(async (ctx, next) => {
  const { type, payload } = ctx.event
  if (type === 'init') {
    await init.init(payload)
  } else if (type === 'setconf') {
    // artificial event, not CloudFormation
    await init.update(payload)
  }
})

bot.ready()
export const handler = lambda.handler
