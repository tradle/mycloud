import { createConf, Conf } from '../configure'
import { fromCloudFormation } from '../../lambda'
import { STACK_UPDATED } from '../lambda-events'
import Errors from '../../errors'

const lambda = fromCloudFormation({ event: STACK_UPDATED, createBot: true })

let conf: Conf
lambda.use(async (ctx, next) => {
  const { bot } = ctx.components
  if (!conf) conf = createConf(ctx.components.bot)

  const { type, payload } = ctx.event
  if (type === 'delete') {
    lambda.logger.debug('deleting custom resource (probably as part of an update)!')
    return
  }

  if (type === 'update' && payload.ImmutableParameters) {
    await Conf.ensureStackParametersDidNotChange({
      from: await bot.stackUtils.getStackParameterValues(),
      to: payload.ImmutableParameters
    })
  }

  // type === 'init' may still be an update
  // because this might be a new stack pointing at old tables/buckets
  let isUpdate
  try {
    const identity = await bot.getMyIdentity()
    isUpdate = !!identity
  } catch (err) {
    Errors.ignoreNotFound(err)
  }

  if (isUpdate) {
    await conf.updateInfra({ bot })
  } else {
    await conf.initInfra({ bot, deploymentConf: payload })
  }
})

export const handler = lambda.handler
