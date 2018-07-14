import once from 'lodash/once'
import partition from 'lodash/partition'
import Errors from '../../errors'
import { fromSchedule } from '../lambda'
import * as LambdaEvents from '../lambda-events'
import { Job, IBotComponents } from '../types'
import * as JOBS from '../jobs'

const lambda = fromSchedule({ event: LambdaEvents.SCHEDULER })
const { bot } = lambda

const MINUTE = 60
const DEFAULT_FUNCTION = 'genericJobRunner'
const COMMON_JOBS:Job[] = [
  {
    name: 'warmup',
    function: 'warmup',
    period: 5 * MINUTE,
    input: {
      concurrency: 5,
      functions: [
        'oniotlifecycle',
        'onmessage',
        'onresourcestream',
        'graphql',
        'info',
        'preauth',
        'auth',
        'inbox',
      ]
    }
  },
  {
    name: 'sealpending',
    function: DEFAULT_FUNCTION,
    period: 10 * MINUTE,
  },
  {
    name: 'pollchain',
    function: DEFAULT_FUNCTION,
    period: 10 * MINUTE,
  },
  {
    name: 'retryDelivery',
    function: DEFAULT_FUNCTION,
    period: MINUTE,
  },
  {
    name: 'checkFailedSeals',
    function: DEFAULT_FUNCTION,
    period: 17 * MINUTE,
  },
  {
    name: 'documentChecker',
    function: DEFAULT_FUNCTION,
    period: MINUTE,
    requiresComponents: ['documentChecker']
  },
]

const addJobs = once((components: IBotComponents) => {
  COMMON_JOBS.forEach(job => {
    if (!JOBS[job.name]) {
      throw new Errors.InvalidEnvironment(`job executor not found: ${job.name}`)
    }
  })

  const [will, wont] = partition(COMMON_JOBS, job =>
    (job.requiresComponents || []).every(name => name in components))

  if (wont.length) {
    lambda.logger.debug(`skipping jobs due to missing/unconfigured components: ${wont.join(', ')}`)
  }

  will.forEach(job => bot.scheduler.add(job))
})

lambda.use(async (ctx) => {
  const { components } = ctx
  addJobs(components)

  const { bot, logger } = components
  try {
    await bot.scheduler.scheduleJobsImmediately()
  } catch (err) {
    logger.error('failed to schedule jobs', Errors.export(err))
  }
})

export const handler = lambda.handler
