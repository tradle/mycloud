const debug = require('debug')('tradle:sls:db-utils')
import {
  marshalItem as marshalDBItem,
  unmarshalItem as unmarshalDBItem
} from 'dynamodb-marshaler'

const { NotFound } = require('./errors')
const { co, pick, logify, timestamp, wait, clone, batchify } = require('./utils')
import { prettify } from './string-utils'
import * as Errors from './errors'
const MAX_BATCH_SIZE = 25
const CONSISTENT_READ_EVERYTHING = true

exports = module.exports = createDBUtils
exports.getRecordsFromEvent = getRecordsFromEvent
exports.getUpdateParams = getUpdateParams
exports.marshalDBItem = marshalDBItem
exports.unmarshalDBItem = unmarshalDBItem

function createDBUtils ({ aws, env }) {
  const debug = env.logger('db-utils')

  function getTable (TableName) {
    const batchPutToTable = co(function* (items) {
      const batches = batchify(items, MAX_BATCH_SIZE)
      for (const batch of batches) {
        debug(`putting batch of ${batch.length} to ${TableName}`)
        yield batchPut({
          RequestItems: {
            [TableName]: batch.map(Item => {
              return {
                PutRequest: { Item }
              }
            })
          }
        })
      }
    })

    const tableAPI = {
      toString: () => TableName,
      batchPut: batchPutToTable
    }

    const api = {
      get,
      put,
      update,
      del,
      findOne,
      find,
      scan,
      create: createTable,
      createTable,
      destroy: deleteTable,
      deleteTable,
      query: find,
      queryOne: findOne,
      clear: () => clear(TableName)
    }

    // aliases
    Object.keys(api).forEach(method => {
      tableAPI[method] = (params={}) => {
        params.TableName = TableName
        // debug(`performing "${method}" on ${TableName}: ${prettify(params)}`)
        return api[method](params)
      }
    })

    tableAPI.name = TableName
    return tableAPI
    // return logify(tableAPI, { log: debug }) //, logInputOutput: DEV })
  }

  const exec = co(function* (method, params) {
    params.ReturnConsumedCapacity = 'TOTAL'
    const result = aws.docClient[method](params).promise()
    logCapacityConsumption(method, result)
    return result
  })

  const dynamoDBExec = function dynamoDBExec (method, params) {
    return aws.dynamodb[method](params).promise()
  }

  const createTable = params => dynamoDBExec('createTable', params)
  const deleteTable = params => dynamoDBExec('deleteTable', params)

  const clear = co(function* (TableName) {
    const tableInfo = yield aws.dynamodb.describeTable({ TableName }).promise()
    const { Table: { KeySchema } } = tableInfo
    const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
    let scan = yield exec('scan', { TableName })
    while (true) {
      let { Items, LastEvaluatedKey } = scan
      if (!Items.length) return

      debug(`deleting ${Items.length} from table ${TableName}`)
      yield Items.map(item => exec('delete', {
        TableName,
        Key: pick(item, keyProps)
      }))

      if (!LastEvaluatedKey) {
        return
      }

      scan = yield exec('scan', { TableName, ExclusiveStartKey: LastEvaluatedKey })
    }
  })

  const listTables = co(function* (env) {
    const { TableNames } = yield aws.dynamodb.listTables().promise()
    return TableNames.filter(name => name.startsWith(env.SERVERLESS_PREFIX))
  })

  const get = co(function* (params) {
    maybeForceConsistentRead(params)
    const result = yield exec('get', params)
    if (!result.Item) {
      throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])))
    }

    // debug(`got item from ${params.TableName}: ${prettify(result)}`)
    return result.Item
  })

  const put = co(function* (params) {
    const result = yield exec('put', params)
    return tweakReturnValue(params, result)
  })

  const del = co(function* (params) {
    const result = yield exec('delete', params)
    return tweakReturnValue(params, result)
  })

  const find = co(function* (params) {
    maybeForceConsistentRead(params)
    const result = yield exec('query', params)
    if (result.LastEvaluatedKey) {
      debug('LastEvaluatedKey', result.LastEvaluatedKey)
    }

    return result.Items
  })

  const findOne = co(function* (params) {
    params.Limit = 1
    const results = yield find(params)
    if (!results.length) {
      throw new NotFound(`"${params.TableName}" query returned 0 items`)
    }

    return results[0]
  })

  const update = co(function* (params) {
    const result = yield exec('update', params)
    return tweakReturnValue(params, result)
  })

  function maybeForceConsistentRead (params) {
    // ConsistentRead not supported on GlobalSecondaryIndexes
    if (CONSISTENT_READ_EVERYTHING && !params.IndexName && !params.ConsistentRead) {
      params.ConsistentRead = true
      debug('forcing consistent read')
    }
  }

  function tweakReturnValue (params, result) {
    if (params.ReturnValues !== 'NONE') {
      return result.Attributes
    }

    return result
  }

  const scan = co(function* (params) {
    maybeForceConsistentRead(params)
    const { Items } = yield exec('scan', params)
    return Items
  })

  const rawBatchPut = co(function* (params) {
    return yield exec('batchWrite', params)
  })

  // const create = co(function* (schema) {
  //   try {
  //     yield dynamodb.createTable(schema).promise()
  //   } catch (err) {
  //     // already exists
  //     if (err.code !== 'ResourceInUseException') {
  //       throw err
  //     }
  //   }
  // })

  const batchPut = co(function* (params, backoffOptions={}) {
    params = clone(params)

    const {
      backoff=defaultBackoffFunction,
      maxTries=6
    } = backoffOptions

    let tries = 0
    let failed
    while (tries < maxTries) {
      let result = yield rawBatchPut(params)
      failed = result.UnprocessedItems
      if (!(failed && Object.keys(failed).length > 0)) return

      params.RequestItems = failed
      yield wait(backoff(tries++))
    }

    const err = new Errors.BatchPutFailed()
    err.failed = failed
    err.attempts = tries
    throw err
  })

  return {
    listTables,
    createTable,
    deleteTable,
    clear,
    get,
    put,
    update,
    del,
    find,
    findOne,
    batchPut,
    getUpdateParams,
    marshalDBItem,
    unmarshalDBItem,
    getTable,
    getRecordsFromEvent
  }
}

function jitter (val, percent) {
  // jitter by val * percent
  // eslint-disable-next-line no-mixed-operators
  return val * (1 + 2 * percent * Math.random() - percent)
}

function defaultBackoffFunction (retryCount) {
  const delay = Math.pow(2, retryCount) * 500
  return Math.min(jitter(delay, 0.1), 10000)
}

function getRecordsFromEvent (event, oldAndNew) {
  return event.Records.map(record => {
    const { NewImage, OldImage } = record.dynamodb
    if (oldAndNew) {
      return {
        old: OldImage && unmarshalDBItem(OldImage),
        new: NewImage && unmarshalDBItem(NewImage)
      }
    }

    return NewImage && unmarshalDBItem(NewImage)
  })
  .filter(data => data)
}

function logCapacityConsumption (method, result) {
  let type
  switch (method) {
  case 'get':
  case 'query':
  case 'scan':
    type = 'RCU'
    break
  default:
    type = 'WCU'
    break
  }

  const { ConsumedCapacity } = result
  if (ConsumedCapacity) {
    debug(`consumed ${prettify(ConsumedCapacity)} ${type}s`)
  }
}

function getUpdateParams (item) {
  const keys = Object.keys(item)
  const toSet = keys.filter(key => item[key] != null)
  const toRemove = keys.filter(key => item[key] == null)

  let UpdateExpression = ''
  if (toSet.length) {
    const ops = toSet.map(key => `#${key} = :${key}`).join(', ')
    UpdateExpression += `SET ${ops} `
  }

  if (toRemove.length) {
    const ops = toRemove.map(key => `#${key}`).join(', ')
    UpdateExpression += `REMOVE ${ops} `
  }

  UpdateExpression = UpdateExpression.trim()
  if (!UpdateExpression.length) {
    throw new Error('nothing was updated!')
  }

  const ExpressionAttributeNames = {}
  const ExpressionAttributeValues = {}
  for (let key in item) {
    ExpressionAttributeNames[`#${key}`] = key
    if (toSet.indexOf(key) !== -1) {
      ExpressionAttributeValues[`:${key}`] = item[key]
    }
  }

  return {
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    UpdateExpression
  }
}
