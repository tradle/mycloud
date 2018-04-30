// @ts-ignore
import Promise from 'bluebird'
import { pick, chunk } from 'lodash'
import { TYPE } from '@tradle/constants'
import { wait } from '../utils'
import Errors from '../errors'
import { getPrimaryKeysProperties } from '../bot/resource'
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
  const modelsToDelete = Object.keys(models).filter(id => {
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

  const types = Object.keys(models)
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

  let users
  do {
    users = await bot.users.list({
      limit: BATCH_SIZE
    })

    await Promise.map(users, async (user) => {
      if (!user.friend) {
        result.deleted.push(user.id)
        await bot.users.del(user.id)
        return
      }

      result.cleaned.push(user.id)
      user = pick(user, ['id', 'friend', 'identity'])
      await bot.users.save(user)
      return
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
    const model = bot.models[type]
    const keyProps = getPrimaryKeysProperties(model)
    let batch
    let count = 0
    do {
      try {
        batch = await db.find({
          allowScan: true,
          select: keyProps,
          filter: {
            EQ: {
              [TYPE]: type
            }
          }
        })
      } catch (err) {
        if (Errors.matches(err, THROTTLING_ERRORS)) {
          let millis = Math.floor(30000 * Math.random())
          bot.logger.warn(`throttled, backing off ${millis}ms`)
          await wait(millis)
        } else {
          throw err
        }
      }

      await Promise.map(batch.items, deleteResource)
      count += batch.items.length
    } while (batch.items.length)

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
