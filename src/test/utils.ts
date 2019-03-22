require('./env').install()

import { randomString } from '../crypto'
import randomName from 'random-name'
import { createTestBot } from '../'
import Errors from '../errors'
import Logger from '../logger'
import { wait } from '../utils'

const bot = createTestBot()
const {
  dbUtils: { getTable, marshallDBItem }
} = bot

const createSilentLogger = () => {
  const logger = new Logger('silent')
  logger.setWriter({
    log: () => {}
  })

  return logger
}

function getSchema(logicalName) {
  const {
    resources: { Resources }
  } = require('../cli/serverless-yml')

  const { Type, Properties } = Resources[logicalName]
  if (Type === 'AWS::DynamoDB::Table' && Properties.StreamSpecification) {
    // for localstack
    Properties.StreamSpecification.StreamEnabled = true
  }

  return Properties
}

const recreateTable = async schema => {
  if (typeof schema === 'string') {
    schema = getSchema(schema)
  }

  const table = getTable(schema.TableName)
  try {
    await table.destroy()
  } catch (err) {}

  await table.create(schema)
  return table
}

function toStreamItems(tableName: string, changes: any[]) {
  return {
    Records: [].concat(changes).map(change => {
      return {
        eventID: randomString(16),
        eventSourceARN: `arn:aws:dynamodb:us-east-1:11111111111:table/${tableName}`,
        dynamodb: {
          NewImage: marshallDBItem(change.value),
          OldImage: change.old && marshallDBItem(change.old)
        }
      }
    })
  }
}

function getter(map) {
  return async key => {
    if (key in map) {
      return map[key]
    }

    throw new Errors.NotFound(key)
  }
}

function putter(map) {
  return async (key, value) => {
    map[key] = value
  }
}

function deleter(map) {
  return async key => {
    const val = map[key]
    delete map[key]
    return val
  }
}

function scanner(map) {
  return async () => {
    return Object.keys(map).map(key => map[key])
  }
}

const createTestProfile = () => {
  const first = randomName.first()
  const last = randomName.last()
  return {
    name: {
      firstName: first,
      lastName: last,
      formatted: first + ' ' + last
    }
  }
}

const recreateDB = async db => {
  await db.destroyTables()
  await db.createTables()
  await wait(2000)
}

export {
  getSchema,
  recreateTable,
  toStreamItems,
  getter,
  putter,
  deleter,
  scanner,
  createSilentLogger,
  createTestProfile,
  recreateDB
}
