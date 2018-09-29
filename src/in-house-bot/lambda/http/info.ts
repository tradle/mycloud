import { createConf } from '../../configure'
import { fromHTTP } from '../../lambda'
import { INFO } from '../../lambda-events'

const lambda = fromHTTP({ event: INFO })
let conf
lambda.use(async (ctx, next) => {
  if (!conf) {
    conf = createConf({ buckets: ctx.components.bot.buckets })
  }

  const result = await conf.getPublicInfo()
  if (!ctx.body) ctx.body = {}
  Object.assign(ctx.body, result)
})

export const handler = lambda.handler
