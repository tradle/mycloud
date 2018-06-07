// @ts-ignore
import Promise from 'bluebird'
import { pick, chunk, isEqual, maxBy } from 'lodash'
import { TYPE, TIMESTAMP } from '@tradle/constants'
import { wait } from '../utils'
import Errors from '../errors'
import { getPrimaryKeysProperties } from '../resource'
import {
  Bot
} from './types'

const accept = (...args:any[]) => Promise.resolve(true)

export const NOT_CLEARABLE_TABLES = [
  'events'
]

export const NOT_CLEARABLE_TYPES = [
  'tradle.PubKey',
  'tradle.Identity',
  'tradle.products.Customer',
  'tradle.cloud.ChildDeployment',
  'tradle.cloud.Configuration',
]

const BATCH_SIZE = 50
const THROTTLING_ERRORS = [
  { code: 'LimitExceededException' },
  { code: 'ProvisionedThroughputExceededException' }
]

export const clearApplications = async ({ bot, confirm=accept }: {
  bot: Bot
  confirm?: (...args:any[]) => Promise<boolean>
}) => {
  bot.ensureDevStage()
  const { models, dbUtils } = bot
  bot.logger.info('finding victims...')

  const { definitions } = dbUtils
  const types = Object.keys(models).filter(id => {
    if (NOT_CLEARABLE_TYPES.includes(id)) return

    const model = models[id]
    if (id === 'tradle.Application' ||
        id === 'tradle.AssignRelationshipManager' ||
        id === 'tradle.Verification' ||
        id === 'tradle.FormRequest') {
      return true
    }

    const { subClassOf } = model
    if (subClassOf === 'tradle.Form' ||
        subClassOf === 'tradle.MyProduct') {
      return true
    }
  })

  const ok = await confirm(types)
  if (!ok) return

  const deleteCounts = await clearTypes({ bot, types })
  const users = await clearUsers({ bot })
  return {
    users,
    rest: deleteCounts
  }
}

export const clearUsers = async ({ bot }: {
  bot: Bot
}) => {
  bot.ensureDevStage()

  const result = {
    deleted: [],
    cleaned: []
  }

  const { deleted, cleaned } = result

  let users
  let time = 0
  do {
    if (users && users.length) {
      const latest = maxBy(users, TIMESTAMP)[TIMESTAMP]
      time = Math.max(latest, time)
    }

    users = await bot.users.list({
      limit: BATCH_SIZE,
      filter: {
        EQ: {},
        GT: {
          [TIMESTAMP]: time
        }
      },
      orderBy: {
        property: '_time',
        desc: false
      }
    })

    await Promise.map(users, async (user) => {
      if (!user.friend) {
        deleted.push(user.id)
        await bot.users.del(user.id)
        return
      }

      const cleanUser = pick(user, ['id', 'friend', 'identity', TYPE, TIMESTAMP])
      if (isEqual(cleanUser, user)) return

      cleaned.push(user.id)
      await bot.users.save(cleanUser)
    })
  } while (users.length)

  return result
}

export const clearTypes = async ({ bot, types }: {
  bot: Bot
  types: string[]
}) => {
  bot.ensureDevStage()

  const typeBatches = chunk(types, 10)
  const { db } = bot
  const deleteCounts = {}
  const deleteResource = async (item) => {
    const type = item[TYPE]
    while (true) {
      try {
        bot.logger.debug(`deleting ${type}`, item)
        await db.del(item)
        break
      } catch (err) {
        if (Errors.isNotFound(err)) {
          return
        }

        if (Errors.matches(err, THROTTLING_ERRORS)) {
          let millis = 1000
          bot.logger.warn(`throttled on delete, will retry after ${millis}ms`, err.name)
          await wait(millis)
        }

        throw err
      }
    }
  }

  await Promise.map(types, async (type) => {
    bot.logger.debug('clearing type', type)
    const model = bot.models[type]
    const keyProps = getPrimaryKeysProperties(model)
    let batch
    let count = 0
    let retry
    do {
      try {
        batch = await db.find({
          allowScan: true,
          select: keyProps,
          filter: {
            EQ: {
              [TYPE]: type
            }
          },
          limit: 100
        })
      } catch (err) {
        if (Errors.matches(err, THROTTLING_ERRORS)) {
          let millis = Math.floor(30000 * Math.random())
          bot.logger.warn(`throttled, backing off ${millis}ms`)
          await wait(millis)
          retry = true
          continue
        } else {
          throw err
        }
      }

      retry = false
      await Promise.map(batch.items, deleteResource, {
        concurrency: 20
      })

      count += batch.items.length
    } while (retry || batch.items.length)

    if (count) deleteCounts[type] = count
  }, {
    concurrency: 10
  })

  return deleteCounts
}

export const clearTables = async ({ bot, tables }: {
  bot: Bot
  tables: string[]
}) => {
  bot.ensureDevStage()
  if (!(tables && tables.length)) return

  const notAllowed = NOT_CLEARABLE_TABLES.filter(shortName => {
    return tables.find(table => table.endsWith(shortName))
  })

  if (notAllowed.length) {
    throw new Error(`not allowed to clear: ${notAllowed.join(', ')}`)
  }

  const counts:any = {}
  tables = tables.map(bot.getStackResourceName)
  for (const table of tables) {
    counts[table] = await bot.dbUtils.clear(table)
  }

  return counts
}
