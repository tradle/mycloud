import { createMiddleware } from '../../lambda/oninit'
import { createConf, Conf } from '../configure'
import { fromCloudFormation } from '../../lambda'
import { STACK_UPDATED } from '../lambda-events'

const lambda = fromCloudFormation({ event: STACK_UPDATED, createBot: true })

let conf: Conf
lambda.use(async (ctx, next) => {
  const { bot } = ctx.components
  if (!conf) conf = createConf(ctx.components.bot)

  const { type, payload } = ctx.event
  if (type === 'init') {
    await conf.initInfra({
      bot,
      deploymentConf: payload
    })
  } else if (type === 'update') {
    await conf.updateInfra({ bot })
  } else if (type === 'delete') {
    lambda.logger.debug('deleting custom resource (probably as part of an update)!')
  }
})

export const handler = lambda.handler
