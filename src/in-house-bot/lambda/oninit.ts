import { createMiddleware } from '../../lambda/oninit'
import { createConf } from '../configure'
import { fromCloudFormation } from '../lambda'
import { STACK_UPDATED } from '../lambda-events'

const lambda = fromCloudFormation({ event: STACK_UPDATED })
let conf

lambda.use(async (ctx, next) => {
  if (!conf) conf = createConf(ctx.components.bot)

  const { type, payload } = ctx.event
  if (type === 'init') {
    await conf.initInfra(payload)
  } else if (type === 'update') {
    await conf.updateInfra(payload)
  } else if (type === 'delete') {
    lambda.logger.debug('deleting custom resource (probably as part of an update)!')
  }
})

export const handler = lambda.handler
