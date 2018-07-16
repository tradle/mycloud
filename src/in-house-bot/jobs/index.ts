// import path from 'path'
// import fs from 'fs'

// fs.readdirSync(__dirname).forEach(file => {
//   if (file.endsWith('.js')) return

//   const job:IPBJobExecutor = require(path.resolve(__dirname, file))
//   job.name
// })

import { IBotComponents, Bot, Seal, Job } from '../types'
import { sendConfirmedSeals } from '../utils'
import { TYPE, ORG, DEFAULT_WARMUP_EVENT } from '../../constants'
import Errors from '../../errors'
import { Deployment } from '../deployment'

const SAFETY_MARGIN_MILLIS = 20000

type ExecInput = {
  job: Job
  components: IBotComponents
}

type Executor = (opts:ExecInput) => Promise<any|void>

export const warmup:Executor = async ({ job, components }) => {
  await components.bot.lambdaUtils.warmUp({
    ...DEFAULT_WARMUP_EVENT,
    ...job.input,
  })
}

export const retryDelivery:Executor = async ({ job, components }) => {
  const { bot } = components
  const failed = await bot.delivery.http.getRetriable()
  if (!failed.length) return

  await bot._fireDeliveryErrorBatchEvent({
    errors: failed,
    async: true,
  })
}

export const pollchain:Executor = async ({ job, components }):Promise<Seal[]> => {
  const { bot } = components
  const { seals, env, logger } = bot
  let results:Seal[] = []
  let batch:Seal[]
  let haveTime
  do {
    if (batch) {
      await sendConfirmedSeals(bot, batch)
    }

    batch = await seals.syncUnconfirmed({ limit: 10 })
    results = results.concat(batch)
    haveTime = env.getRemainingTime() > SAFETY_MARGIN_MILLIS
  } while (haveTime && batch.length)

  if (!haveTime) {
    logger.debug('almost out of time, exiting early')
  }

  return results
}

export const sealpending:Executor = async ({ job, components }):Promise<Seal[]> => {
  const { bot } = components
  const { seals, env, logger } = bot
  let results = []
  let error
  let batch
  let haveTime
  do {
    if (batch) {
      await sendConfirmedSeals(bot, batch.seals)
    }

    batch = await seals.sealPending({ limit: 10 })
    results = results.concat(batch.seals)
    error = batch.error
    haveTime = env.getRemainingTime() > SAFETY_MARGIN_MILLIS
  } while (haveTime && !error && batch.seals.length)

  if (!haveTime) {
    logger.debug('almost out of time, exiting early')
  }

  return results
}

const SIX_HOURS = 6 * 3600 * 1000
export const checkFailedSeals:Executor = async ({ job, components }) => {
  const { gracePeriod=SIX_HOURS } = job
  return await components.bot.seals.handleFailures({ gracePeriod })
}

export const documentChecker:Executor = async ({ job, components }) => {
  const { logger, documentChecker } = components
  if (!documentChecker) {
    logger.debug('document checker not set up')
    return
  }

  // // document checker rate-limits to 1/min
  return await documentChecker.checkPending({ limit: 1 })
}
