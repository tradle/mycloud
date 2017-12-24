import { createConf } from '../../configure'
import { createBot } from '../../../bot'
import { EventSource } from '../../../lambda'

const bot = createBot()
const conf = createConf({ bot })
const lambda = bot.lambdas.info()
lambda.use(async (ctx, next) => {
  const result = await conf.getPublicInfo()
  if (!ctx.body) ctx.body = {}
  Object.assign(ctx.body, result)
})

export const handler = lambda.handler
