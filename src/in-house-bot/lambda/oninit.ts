import { createConf } from '../configure'
import { createBot } from '../../'
import Errors from '../../errors'
// import { STACK_UPDATED } from '../lambda-events'

const bot = createBot()
const lambda = bot.lambdas.oninit()
const conf = createConf({ bot })
lambda.use(async (ctx, next) => {
  const { type, payload } = ctx.event

  if (type === 'delete') {
    lambda.logger.debug('deleting custom resource (probably as part of an update)!')
    return
  }

  if (type === 'update' && payload.ImmutableParameters) {
    await conf.ensureStackParametersDidNotChange(payload.ImmutableParameters)
  }

  // type === 'init' may still be an update
  // because this might be a new stack pointing at old tables/buckets
  let isUpdate
  try {
    const identity = await conf.bot.getMyIdentity()
    isUpdate = !!identity
  } catch (err) {
    Errors.ignoreNotFound(err)
  }

  if (isUpdate) {
    await conf.updateInfra(payload)
  } else {
    await conf.initInfra(payload)
  }
})

export const handler = lambda.handler
