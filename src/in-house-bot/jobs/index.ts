// import path from 'path'
// import fs from 'fs'

// fs.readdirSync(__dirname).forEach(file => {
//   if (file.endsWith('.js')) return

//   const job:IPBJobExecutor = require(path.resolve(__dirname, file))
//   job.name
// })

import getPropAtPath from 'lodash/get'
import Errors from '../../errors'
import { IBotComponents, Seal, Job, LowFundsInput } from '../types'
import { sendConfirmedSeals } from '../utils'
import { DEFAULT_WARMUP_EVENT, TYPES } from '../../constants'
import { AthenaFeed } from './athenafeed'
import { ImportPsc } from './importPsc'
import { ImportRefdata } from './importRefdata'
import { ImportPitchbookData } from './importPitchbook'
import { ImportMaxmindDb } from './importMaxmindDb'
import { Chaser } from './chaser'
// import { Deployment } from '../deployment'

const SAFETY_MARGIN_MILLIS = 20000

type ExecInput = {
  job: Job
  components: IBotComponents
}

type Executor = (opts: ExecInput) => Promise<any | void>

export const chaser: Executor = async ({ job, components }) => {
  const { bot } = components
  let chaser = new Chaser(bot)
  await chaser.chase()
}

export const exportObjectsToAthena: Executor = async ({ job, components }) => {
  let feeder = new AthenaFeed(components.bot)
  try {
    await feeder.objectsDump()
  } catch (err) {
    components.bot.logger.error('job exportObjectsToAthena failed', err)
  }
}

export const importPsc: Executor = async ({ job, components }) => {
  const orgConf = components.conf
  const { org } = orgConf
  let importer = new ImportPsc(components.bot, components.applications, org)
  try {
    importer.movePSC() // notifyAdmin() //  movePSC()
  } catch (err) {
    components.bot.logger.error('job importPsc failed', err)
  }
}

export const importRefdata: Executor = async ({ job, components }) => {
  let importer = new ImportRefdata(components.bot)
  try {
    importer.move()
  } catch (err) {
    components.bot.logger.error('job importRefdata failed', err)
  }
}

export const importPitchbookData: Executor = async ({ job, components }) => {
  let importer = new ImportPitchbookData(components.bot)
  try {
    importer.move()
  } catch (err) {
    components.bot.logger.error('job importPitchbookData failed', err)
  }
}


export const importMaxmindDb: Executor = async ({ job, components }) => {
  let importer = new ImportMaxmindDb(components.bot)
  try {
    importer.execute()
  } catch (err) {
    components.bot.logger.error('job importMaxmindDb failed', err)
  }
}


export const warmup: Executor = async ({ job, components }) => {
  await components.bot.lambdaWarmup.warmUp({
    ...DEFAULT_WARMUP_EVENT,
    ...job.input
  })
}

export const reinitializeContainers: Executor = async ({ job, components }) => {
  const { stackUtils, lambdaInvoker } = components.bot
  const functions = getPropAtPath(job, ['input', 'functions'])
  await stackUtils.reinitializeContainers(functions)
  await lambdaInvoker.scheduleWarmUp()
}

export const retryDelivery: Executor = async ({ job, components }) => {
  const { bot } = components
  const failed = await bot.delivery.http.getRetriable()
  if (!failed.length) return

  await bot._fireDeliveryErrorBatchEvent({
    errors: failed,
    async: true
  })
}

export const pollchain: Executor = async ({ job, components }): Promise<Seal[]> => {
  const { bot } = components
  const { seals, env, logger } = bot
  let results: Seal[] = []
  let batch: Seal[]
  let haveTime
  do {
    if (batch) {
      logger.debug(`sending ${batch.length} confirmed seals`)
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

const isLowFundsError = (err: any) => Errors.matches(err, { name: 'LowFunds' })

export const sealpending: Executor = async ({ job, components }): Promise<Seal[]> => {
  const { bot, alerts } = components
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

  if (error && isLowFundsError(error)) {
    await alerts.lowFunds(error as LowFundsInput)
  }

  return results
}

const SIX_HOURS = 6 * 3600 * 1000
export const checkFailedSeals: Executor = async ({ job, components }) => {
  const { gracePeriod = SIX_HOURS } = job
  return await components.bot.seals.handleFailures({ gracePeriod })
}

export const createSealBatch: Executor = async ({ job, components }) => {
  const { bot, logger } = components
  const { sealBatcher } = bot
  const unsigned = await sealBatcher.genNextBatch()
  // if (!unsigned) {
  //   logger.debug('skipping create of seal batch, nothing to batch')
  //   return
  // }

  logger.debug('creating seal batch')
  const signed = await bot
    .draft({
      type: TYPES.SEALABLE_BATCH,
      resource: unsigned
    })
    .signAndSave()
    .then(r => r.toJSON())

  await bot.seal({
    object: signed
  })
}

// export const documentChecker:Executor = async ({ job, components }) => {
//   const { logger, documentChecker } = components
//   if (!documentChecker) {
//     logger.debug('document checker not set up')
//     return
//   }

//   // // document checker rate-limits to 1/min
//   return await documentChecker.checkPending({ limit: 1 })
// }

// export const cleanupTmpSNSTopics:Executor = async ({ job, components }) => {
//   const { bot, logger } = components
//   const deployment = components.deployment || new Deployment({ bot, logger })
//   await deployment.deleteExpiredTmpTopics()
// }
