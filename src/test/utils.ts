require('./env').install()

import randomName = require('random-name')
import { co } from '../utils'
import { createTestTradle } from '../'
import Errors = require('../errors')
import yml = require('../cli/serverless-yml')
import Logger from '../logger'

const tradle = createTestTradle()
const {
  dbUtils: { getTable, marshalDBItem }
} = tradle

const createSilentLogger = () => {
  const logger = new Logger('silent')
  logger.setWriter({
    log: () => {}
  })

  return logger
}

function getSchema (logicalName) {
  const {
    resources: {
      Resources
    }
  } = require('../cli/serverless-yml')

  const { Type, Properties } = Resources[logicalName]
  if (Type === 'AWS::DynamoDB::Table' && Properties.StreamSpecification) {
    // for localstack
    Properties.StreamSpecification.StreamEnabled = true
  }

  return Properties
}

const recreateTable = co(function* (schema) {
  if (typeof schema === 'string') {
    schema = getSchema(schema)
  }

  const table = getTable(schema.TableName)
  try {
    yield table.destroy()
  } catch (err) {}

  yield table.create(schema)
  return table
})

function toStreamItems (changes) {
  return {
    Records: [].concat(changes).map(change => {
      return {
        dynamodb: {
          NewImage: marshalDBItem(change.new),
          OldImage: change.old && marshalDBItem(change.old)
        }
      }
    })
  }
}

function getter (map) {
  return co(function* (key) {
    if (key in map) {
      return map[key]
    }

    throw new Errors.NotFound(key)
  })
}

function putter (map) {
  return co(function* (key, value) {
    map[key] = value
  })
}

function deleter (map) {
  return co(function* (key) {
    const val = map[key]
    delete map[key]
    return val
  })
}

function scanner (map) {
  return co(function* () {
    return Object.keys(map).map(key => map[key])
  })
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

export {
  getSchema,
  recreateTable,
  toStreamItems,
  getter,
  putter,
  deleter,
  scanner,
  createSilentLogger,
  createTestProfile
}
