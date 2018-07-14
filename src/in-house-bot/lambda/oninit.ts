import once from 'lodash/once'
import AWS from 'aws-sdk'
import { configureLambda } from '../'
import { createConf } from '../configure'
import { createBot } from '../../'
import { ensureInitialized } from '../init'
import { STACK_UPDATED } from '../lambda-events'

const bot = createBot()
const lambda = bot.lambdas.oninit()
const conf = createConf({ bot })

const loadComponents = once(() => configureLambda({ lambda, event: STACK_UPDATED }))
bot.hookSimple(`stack:update`, async () => {
  const components = await loadComponents()
  await ensureInitialized(components)
})

lambda.use(async (ctx, next) => {
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
