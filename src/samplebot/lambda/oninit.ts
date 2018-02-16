import { createConf } from '../configure'
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.oninit()
const conf = createConf({ bot })

lambda.use(async (ctx, next) => {
  const { type, payload } = ctx.event
  if (type === 'init') {
    await conf.initStack(payload)
  } else if (type === 'update') {
    await conf.updateStack(payload)
  }
})

export const handler = lambda.handler
