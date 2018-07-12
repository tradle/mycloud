import { fromLambda } from '../lambda'
import * as LambdaEvents from '../lambda-events'
import * as JOBS from '../jobs'
import { Job } from '../types'

const lambda = fromLambda({ event: LambdaEvents.SCHEDULER })
const { bot } = lambda

Object.keys(JOBS).forEach(name => {
  const exec = JOBS[name]
  bot.logger.debug(`registered job: ${name}`)
  bot.hookSimple(`job:${name}`, JOBS[name])
})

lambda.use(async (ctx) => {
  const job: Job = ctx.event
  const { components } = ctx
  await bot.fire(`job:${job.name}`, { job, components })
})
