import Errors from '../errors'
import { isProbablyTradle } from './utils'
import { IBotComponents, Bot, Seal, Job } from './types'
import { doesHttpEndpointExist, toLexicographicVersion } from '../utils'
import { TYPE } from '../constants'
import { TRADLE_MYCLOUD_URL } from './constants'

const VERSION_INFO = 'tradle.cloud.VersionInfo'
const ALERT_BRANCHES = [
  'master',
  'jobs'
]

export const checkVersion = async (components: IBotComponents) => {
  const { bot, logger, conf, deployment } = components
  const { version } = bot
  const botPermalink = await bot.getMyPermalink()

  let existing
  try {
    existing = await deployment.getVersionInfoByTag(version.tag)
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
  if (!ALERT_BRANCHES.includes(version.branch)) {
    logger.debug(`not alerting friends of new version`)
    return
  }

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

export const ensureInitialized = async (components: IBotComponents) => {
  const { bot, conf } = components
  if (isProbablyTradle(conf)) {
    await checkVersion(components)
    return
  }

  const { friend } = await reportLaunch({ components, targetApiUrl: TRADLE_MYCLOUD_URL })
  // await friendTradle(components.bot)
  // if (friend) {
  //   await sendTradleSelfIntro({ bot, friend })
  // }
}

const reportLaunch = async ({ components, targetApiUrl }: {
  components: IBotComponents
  targetApiUrl: string
}) => {
  const { bot, logger, conf, deployment } = components
  logger.debug('reporting launch to tradle')
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
//   await sendTradleSelfIntro({ bot, friend })
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

// const sendTradleSelfIntro = async ({ bot, friend }: {
//   bot: Bot
//   friend: any
// }) => {
//   try {
//     const identity = await bot.getMyIdentity()
//     return await bot.db.findOne({
//       filter: {
//         EQ: {
//           [TYPE]: 'tradle.SelfIntroduction',
//           'identity._permalink': identity._permalink,
//           'target._permalink': friend.identity._permalink,
//         }
//       }
//     })
//   } catch (err) {
//     Errors.ignoreNotFound(err)
//   }

//   return await bot.send({
//     friend,
//     object: bot.draft({ type: 'tradle.SelfIntroduction' })
//       .set({
//         identity,
//         target: friend.identity,
//       })
//       .toJSON()
//   })
// }

// const sendTradleFriendRequest = async ({ bot, friend }: {
//   bot: Bot
//   friend: any
// }) => {
//   const friendIdentityPermalink = friend.identity._permalink
//   try {
//     return await bot.db.findOne({
//       filter: {
//         EQ: {
//           [TYPE]: 'tradle.cloud.FriendRequest',
//           'friendIdentity._permalink': friendIdentityPermalink,
//         }
//       }
//     })
//   } catch (err) {
//     Errors.ignoreNotFound(err)
//   }

//   const req = await bot.draft({ type: 'tradle.cloud.FriendRequest' })
//     .set({
//       friendIdentity: friend.identity
//     })
//     .sign()
//     .then(r => r.toJSON())

//   await bot.send({
//     friend,
//     object: req,
//   })
// }
