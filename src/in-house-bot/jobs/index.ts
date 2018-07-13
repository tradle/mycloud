// import path from 'path'
// import fs from 'fs'

// fs.readdirSync(__dirname).forEach(file => {
//   if (file.endsWith('.js')) return

//   const job:IPBJobExecutor = require(path.resolve(__dirname, file))
//   job.name
// })

import { IBotComponents, Bot, Seal, Job } from '../types'
import { sendConfirmedSeals } from '../utils'
import { TYPE, ORG, DEFAULT_WARMUP_EVENT, TRADLE_MYCLOUD_URL } from '../../constants'
import Errors from '../../errors'
import { doesHttpEndpointExist, toLexicographicVersion } from '../../utils'
import { isProbablyTradle } from '../utils'
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
  const failed = await bot.delivery.http.getErrors()
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

const VERSION_INFO = 'tradle.cloud.VersionInfo'
export const checkVersion = async (components: IBotComponents) => {
  const { bot, logger, conf } = components
  const { version } = bot
  const botPermalink = await bot.getMyPermalink()
  const deployment = new Deployment({
    bot,
    logger,
    orgConf: conf
  })

  let existing
  try {
    existing = deployment.getVersionInfoByTag(version.tag)
    return
  } catch (err) {
    Errors.ignoreNotFound(err)
  }

  const promiseFriends = bot.friends.list()
  const { templateUrl } = bot.stackUtils.getStackLocation(version)

  // ensure template exists
  const exists = await doesHttpEndpointExist(templateUrl)
  if (!exists) {
    throw new Error(`templateUrl not accessible: ${templateUrl}`)
  }

  const vInfo = await deployment.saveVersionInfo({ ...version, templateUrl })
  const friends = await promiseFriends
  logger.debug(`notifying ${friends.length} friends about MyCloud update`, version)

  await Promise.all(friends.map(async (friend) => {
    logger.debug(`notifying ${friend.name} about MyCloud update`)
    await bot.send({
      to: friend.identity._permalink,
      object: vInfo
    })
  }))
}

export const ensureInitialized:Executor = async ({ job, components }) => {
  const { bot, conf } = components
  if (isProbablyTradle(conf)) {
    // do nothing
    await checkVersion(components)
  } else {
    const { friend } = await reportLaunch({ components, targetApiUrl: TRADLE_MYCLOUD_URL })
    // await friendTradle(components.bot)
    if (friend) {
      await sendTradleFriendRequest({ bot, friend })
    }
  }
}

const reportLaunch = async ({ components, targetApiUrl }: {
  components: IBotComponents
  targetApiUrl: string
}) => {
  const { bot, logger, conf } = components
  const deployment = new Deployment({
    bot,
    logger,
    orgConf: conf
  })

  try {
    return await deployment.reportLaunch({
      myOrg: conf.org,
      targetApiUrl,
    })
  } catch(err) {
    Errors.rethrow(err, 'developer')
    logger.error('failed to report launch to Tradle', err)
    return { friend: null, parentDeployment: null }
  }
}

// const friendTradle = async (bot: Bot) => {
//   const friend = await addTradleAsFriend(bot)
//   await sendTradleFriendRequest({ bot, friend })
// }

// const addTradleAsFriend = async (bot: Bot) => {
//   try {
//     return await bot.friends.getByDomain('tradle.io')
//   } catch (err) {
//     Errors.ignoreNotFound(err)
//   }

//   return await bot.friends.load({
//     domain: 'tradle.io',
//     url: TRADLE_MYCLOUD_URL
//   })
// }

const sendTradleFriendRequest = async ({ bot, friend }: {
  bot: Bot
  friend: any
}) => {
  const friendIdentityPermalink = friend.identity._permalink
  try {
    return await bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: 'tradle.cloud.FriendRequest',
          'friendIdentity._permalink': friendIdentityPermalink,
        }
      }
    })
  } catch (err) {
    Errors.ignoreNotFound(err)
  }

  const req = await bot.draft({ type: 'tradle.cloud.FriendRequest' })
    .set({
      friendIdentity: friend.identity
    })
    .sign()
    .then(r => r.toJSON())

  await bot.send({
    friend,
    object: req,
  })
}
