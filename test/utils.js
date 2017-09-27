require('./env')

const { co } = require('../lib/utils')
const { isResourceEnvironmentVariable } = require('../lib/resources')
const {
  dbUtils: { getTable, marshalDBItem }
} = require('../')

const Errors = require('../lib/errors')
const yml = require('../lib/cli/serverless-yml')

function getSchema (logicalName) {
  const {
    resources: {
      Resources
    }
  } = require('../lib/cli/serverless-yml')

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

function reprefixServices (map, prefix) {
  const { service } = yml
  const { stage } = yml.custom
  const reprefixed = {}
  for (let key in map) {
    let val = map[key]
    if (isResourceEnvironmentVariable(key)) {
      reprefixed[key] = val.replace(`${service}-${stage}-`, prefix)
    } else {
      reprefixed[key] = val
    }
  }

  return reprefixed
}

module.exports = {
  getSchema,
  recreateTable,
  toStreamItems,
  getter,
  putter,
  deleter,
  scanner,
  reprefixServices
}
