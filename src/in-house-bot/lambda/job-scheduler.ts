import Errors from '../../errors'
import { fromSchedule } from '../lambda'
import * as LambdaEvents from '../lambda-events'
import { Job } from '../types'

// add in LambdaEvents, e.g.:
// event: LambdaEvents.DOCUMENT_CHECKER_JOB
const lambda = fromSchedule({ event: LambdaEvents.SCHEDULER })
const { bot } = lambda

const MINUTE = 60
const DEFAULT_FUNCTION = 'genericJobRunner'
const DEFAULT_JOBS:Job[] = [
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
    name: 'delivery-retry',
    function: DEFAULT_FUNCTION,
    period: MINUTE,
  },
  {
    name: 'check-failed-seals',
    function: DEFAULT_FUNCTION,
    period: 17 * MINUTE,
  },
  {
    name: 'documentChecker',
    function: DEFAULT_FUNCTION,
    period: MINUTE,
  },
  {
    name: 'versionCheck',
    function: DEFAULT_FUNCTION,
    period: 5 * MINUTE,
  },
]

DEFAULT_JOBS.forEach(job => bot.jobs.add(job))

lambda.use(async (ctx) => {
  const { components } = ctx
  const { bot, logger } = components
  try {
    await bot.jobs.scheduleJobsImmediately()
  } catch (err) {
    logger.error('failed to schedule jobs', Errors.export(err))
  }
})

export const handler = lambda.handler
