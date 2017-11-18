require('./env')

const { co } = require('../utils')
const { isResourceEnvironmentVariable } = require('../resources')
const {
  dbUtils: { getTable, marshalDBItem }
} = require('../').tradle

const Errors = require('../errors')
const yml = require('../cli/serverless-yml')

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

function loudAsync (asyncFn) {
  return async (...args) => {
    try {
      return await asyncFn(...args)
    } catch (err) {
      console.error(err)
      throw err
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
  reprefixServices,
  loudAsync
}
