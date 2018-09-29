import { createConf, Conf } from '../../configure'
import { fromHTTP } from '../../lambda'
import { INFO } from '../../lambda-events'
import { createMiddleware } from '../../../lambda/info'

const lambda = fromHTTP({ event: INFO })
lambda.use(createMiddleware())

let conf: Conf
lambda.use(async (ctx, next) => {
  if (!conf) {
    conf = createConf(ctx.components.bot)
  }

  const result = await conf.getPublicInfo()
  if (!ctx.body) ctx.body = {}
  Object.assign(ctx.body, result)
})

export const handler = lambda.handler
