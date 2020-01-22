import once from 'lodash/once'
import partition from 'lodash/partition'
import Errors from '../../errors'
import { fromSchedule } from '../lambda'
import * as LambdaEvents from '../lambda-events'
import { Job, IBotComponents } from '../types'
import * as JOBS from '../jobs'
import {
  WARMUP_PERIOD,
  DEFAULT_JOB_RUNNER_FUNCTION,
  POLLCHAIN_FUNCTION,
  SEALPENDING_FUNCTION,
  WARMUP_FUNCTION,
} from '../../constants'

const lambda = fromSchedule({ event: LambdaEvents.SCHEDULER })
const { bot } = lambda

const MINUTE = 60

const COMMON_JOBS: Job[] = [
  {
    name: 'warmup',
    function: WARMUP_FUNCTION,
    period: WARMUP_PERIOD / 1000,
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
      ].map(shortName => bot.env.getStackResourceName(shortName))
    }
  },
  {
    name: 'sealpending',
    function: SEALPENDING_FUNCTION,
    period: 7 * MINUTE,
  },
  {
    name: 'pollchain',
    function: POLLCHAIN_FUNCTION,
    period: 11 * MINUTE,
  },
  {
    name: 'retryDelivery',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: MINUTE,
  },
  {
    name: 'checkFailedSeals',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 17 * MINUTE,
  },
  {
    name: 'exportObjectsToAthena',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 30 * MINUTE,
  },
  {
    name: 'importPsc',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 60 * MINUTE,
  },
  {
    name: 'roarFeedback',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 1 * MINUTE
  },
  {
    name: 'importBasicCompanyData',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 90 * MINUTE
  },
  {
    name: 'importRefdata',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 60 * MINUTE,
  },
  {
    name: 'importPitchbookData',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 30 * MINUTE,
  },
  {
    name: 'importMaxmindDb',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 1 * 60 * MINUTE,
  },
  {
    name: 'chaser',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: 30 * MINUTE,
  },

  // {
  //   name: 'documentChecker',
  //   function: DEFAULT_JOB_RUNNER_FUNCTION,
  //   period: MINUTE,
  //   requiresComponents: ['documentChecker']
  // },
  // {
  //   name: 'cleanupTmpSNSTopics',
  //   function: DEFAULT_JOB_RUNNER_FUNCTION,
  //   // 24 hours
  //   period: 24 * 60 * MINUTE,
  //   requiresComponents: ['deployment']
  // },
]

if (bot.env.SEALING_MODE === 'batch') {
  bot.logger.debug('scheduling batch sealing job')
  COMMON_JOBS.push({
    name: 'createSealBatch',
    function: DEFAULT_JOB_RUNNER_FUNCTION,
    period: bot.env.SEAL_BATCHING_PERIOD || 5,
  })
} else {
  bot.logger.debug('sealing in single mode')
}

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
  await bot.scheduler.scheduleJobsImmediately()
})

export const handler = lambda.handler
