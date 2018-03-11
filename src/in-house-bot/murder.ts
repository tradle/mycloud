import { pick, } from 'lodash'
import { TYPE } from '@tradle/constants'
import { wait } from '../utils'
import {
  Bot
} from './types'

const accept = (...args:any[]) => Promise.resolve(true)
export const NOT_CLEARABLE = [
  'pubkeys',
  'presence',
  'events',
  'seals',
  'friends'
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
  const users = await clearUsersTable({ bot })
  return {
    users,
    rest: deleteCounts
  }
}

export const clearUsersTable = async ({ bot }: {
  bot: Bot
}) => {
  bot.ensureDevStage()

  const { dbUtils } = bot
  const { definitions } = dbUtils
  const { TableName } = definitions.UsersTable.Properties
  const { KeySchema } = await dbUtils.getTableDefinition(TableName)
  const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
  const result = {
    deleted: [],
    cleaned: []
  }

  await dbUtils.batchProcess({
    batchSize: 20,
    params: {
      TableName
    },
    processOne: async (item) => {
      if (item.friend) {
        result.cleaned.push(pick(item, keyProps))
        await dbUtils.put({
          TableName,
          Item: pick(item, keyProps.concat(['friend', 'identity']))
        })

        return
      }

      const Key = pick(item, keyProps)
      await dbUtils.del({ TableName, Key })
      result.deleted.push(Key)
    }
  })

  return result
}

export const clearTypes = async({ bot, types }: {
  bot: Bot
  types: string[]
}) => {
  bot.ensureDevStage()

  const { dbUtils } = bot
  const { getModelMap, clear } = dbUtils
  const modelMap = getModelMap({ types })

  let deleteCounts = {}
  const buckets = []
  types.forEach(id => {
    const bucketName = modelMap.models[id]
    if (!buckets.includes(bucketName)) {
      buckets.push(bucketName)
    }
  })

  console.log('deleting items from buckets:', buckets.join(', '))
  await Promise.all(buckets.map(async (TableName) => {
    const { KeySchema } = await dbUtils.getTableDefinition(TableName)
    const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
    const processOne = async (item) => {
      const type = item[TYPE]
      if (!types.includes(item[TYPE])) return

      const Key = pick(item, keyProps)
      while (true) {
        try {
          console.log('deleting item', Key, 'from', TableName)
          await dbUtils.del({ TableName, Key })
          break
        } catch (err) {
          const { name } = err
          if (!(name === 'ResourceNotFoundException' ||
            name === 'LimitExceededException' ||
            name === 'ProvisionedThroughputExceededException')) {
            throw err
          }

          await wait(1000)
          console.log('failed to delete item, will retry', err.name)
        }
      }

      if (!deleteCounts[TableName]) {
        deleteCounts[TableName] = {}
      }

      if (deleteCounts[TableName][type]) {
        deleteCounts[TableName][type]++
      } else {
        deleteCounts[TableName][type] = 1
      }
    }

    await dbUtils.batchProcess({
      batchSize: 20,
      params: { TableName },
      processOne
    })
  }))

  return deleteCounts
}

export const clearTables = async ({ bot, tables }: {
  bot: Bot
  tables: string[]
}) => {
  bot.ensureDevStage()
  if (!(tables && tables.length)) return

  const notAllowed = NOT_CLEARABLE.filter(shortName => {
    return tables.find(table => table.endsWith(shortName))
  })

  if (notAllowed.length) {
    throw new Error(`not allowed to clear: ${notAllowed.join(', ')}`)
  }

  const counts:any = {}
  for (const table of tables) {
    if (/-users$/.test(table)) {
      counts.users = await clearUsersTable({ bot })
    }

    counts[table] = await bot.dbUtils.clear(table)
  }

  return counts
}
