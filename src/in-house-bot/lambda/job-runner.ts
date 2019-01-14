import once from 'lodash/once'
import Errors from '../../errors'
import { fromLambda } from '../lambda'
import * as LambdaEvents from '../lambda-events'
import * as JOBS from '../jobs'
import { Job } from '../types'

const lambda = fromLambda({ event: LambdaEvents.SCHEDULER })
const names = Object.keys(JOBS)
names.forEach(name => {
  const exec = JOBS[name]
  lambda.logger.debug(`registered job: ${name}`)
})

const hookIn = once(bot => names.forEach(name => bot.hookSimple(`job:${name}`, JOBS[name])))

lambda.use(async (ctx) => {
  const job: Job = ctx.event
  const { components } = ctx
  const { bot, logger } = components

  hookIn(bot)

  if (!job.name) {
    ctx.body = {
      error: Errors.exportMini(new Errors.InvalidInput(`job missing name: ${JSON.stringify(job)}`))
    }

    return
  }

  logger.debug(`running job: ${job.name}`)
  await bot.fire(`job:${job.name}`, { job, components })
})

export const handler = lambda.handler
