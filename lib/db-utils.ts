const debug = require('debug')('tradle:sls:db-utils')
import {
  marshalItem as marshalDBItem,
  unmarshalItem as unmarshalDBItem
} from 'dynamodb-marshaler'

import { utils as vrUtils } from '@tradle/validate-resource'
const { NotFound } = require('./errors')
const { co, pick, logify, timestamp, wait, clone, batchify } = require('./utils')
import { prettify, alphabetical } from './string-utils'
import { sha256 } from './crypto'
import * as Errors from './errors'
import Env from './env'
const MAX_BATCH_SIZE = 25
const CONSISTENT_READ_EVERYTHING = true
const definitions = require('./definitions')
const TABLE_BUCKET_REGEX = /-bucket-\d+$/

export default createDBUtils
export {
  getRecordsFromEvent,
  getUpdateParams,
  marshalDBItem,
  unmarshalDBItem
}

function createDBUtils ({ aws, env }) {
  const logger = env.sublogger('db-utils')
  const { debug } = logger

  let tableBuckets
  const getTableBuckets = () => {
    if (!tableBuckets) {
      tableBuckets = Object.keys(definitions)
        .filter(logicalId => {
          return TABLE_BUCKET_REGEX.test(definitions[logicalId].Properties.TableName)
        })
        .map(logicalId => definitions[logicalId].Properties)
    }

    return tableBuckets
  }

  function getTable (TableName) {
    const batchPutToTable = async (items) => {
      const batches = batchify(items, MAX_BATCH_SIZE)
      for (const batch of batches) {
        debug(`putting batch of ${batch.length} to ${TableName}`)
        await batchPut({
          RequestItems: {
            [TableName]: batch.map(Item => {
              return {
                PutRequest: { Item }
              }
            })
          }
        })
      }
    }

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

  const forEachItem = async ({ tableName, fn }) => {
    const TableName = tableName
    const tableDescription = await aws.dynamodb.describeTable({ TableName }).promise()
    let count = 0
    let scan = await exec('scan', { TableName })
    while (true) {
      let { Items, LastEvaluatedKey } = scan
      if (!Items.length) break

      const results = await Promise.all(Items.map((item, i) => fn({
        tableDescription,
        i,
        item,
      })))

      // allow abort mid-way
      if (results.includes(false)) break

      count += Items.length
      if (!LastEvaluatedKey) {
        break
      }

      scan = await exec('scan', {
        TableName,
        ExclusiveStartKey: LastEvaluatedKey
      })
    }

    return count
  }

  const clear = async (TableName:string) => {
    return await forEachItem({
      tableName: TableName,
      fn: async ({ item, tableDescription }) => {
        const { KeySchema } = tableDescription.Table
        const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
        await exec('delete', {
          TableName,
          Key: pick(item, keyProps)
        })
      }
    })
  }

  const listTables = async (env:Env) => {
    let tables:string[] = []
    let opts:AWS.DynamoDB.ListTablesInput = {}
    while (true) {
      let {
        TableNames,
        LastEvaluatedTableName
      } = await aws.dynamodb.listTables(opts).promise()

      tables = tables.concat(TableNames)
      if (!TableNames.length || !LastEvaluatedTableName) {
        break
      }

      opts.ExclusiveStartTableName = LastEvaluatedTableName
    }

    return tables.filter(name => name.startsWith(env.SERVERLESS_PREFIX))
  }

  const get = async (params:AWS.DynamoDB.GetItemInput) => {
    maybeForceConsistentRead(params)
    const result = await exec('get', params)
    if (!result.Item) {
      throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])))
    }

    // debug(`got item from ${params.TableName}: ${prettify(result)}`)
    return result.Item
  }

  const put = async (params:AWS.DynamoDB.PutItemInput) => {
    const result = await exec('put', params)
    return tweakReturnValue(params, result)
  }

  const del = async (params:AWS.DynamoDB.DeleteItemInput) => {
    const result = await exec('delete', params)
    return tweakReturnValue(params, result)
  }

  const find = async (params:AWS.DynamoDB.QueryInput) => {
    maybeForceConsistentRead(params)
    const result = await exec('query', params)
    if (result.LastEvaluatedKey) {
      debug('LastEvaluatedKey', result.LastEvaluatedKey)
    }

    return result.Items
  }

  const findOne = async (params:AWS.DynamoDB.QueryInput) => {
    params.Limit = 1
    const results = await find(params)
    if (!results.length) {
      throw new NotFound(`"${params.TableName}" query returned 0 items`)
    }

    return results[0]
  }

  const update = async (params:AWS.DynamoDB.UpdateItemInput) => {
    const result = await exec('update', params)
    return tweakReturnValue(params, result)
  }

  function maybeForceConsistentRead (params) {
    // ConsistentRead not supported on GlobalSecondaryIndexes
    if (CONSISTENT_READ_EVERYTHING && !params.IndexName && !params.ConsistentRead) {
      params.ConsistentRead = true
      logger.info('forcing consistent read')
    }
  }

  function tweakReturnValue (params, result) {
    if (params.ReturnValues !== 'NONE') {
      return result.Attributes
    }

    return result
  }

  const scan = async (params:AWS.DynamoDB.ScanInput) => {
    maybeForceConsistentRead(params)
    const { Items } = await exec('scan', params)
    return Items
  }

  const rawBatchPut = async (params:AWS.DynamoDB.BatchWriteItemInput) => {
    return await exec('batchWrite', params)
  }

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

  const batchPut = async (params:AWS.DynamoDB.BatchWriteItemInput, backoffOptions={}) => {
    params = clone(params)

    const {
      backoff=defaultBackoffFunction,
      maxTries=6
    } = backoffOptions

    let tries = 0
    let failed
    while (tries < maxTries) {
      let result = await rawBatchPut(params)
      failed = result.UnprocessedItems
      if (!(failed && Object.keys(failed).length > 0)) return

      params.RequestItems = failed
      await wait(backoff(tries++))
    }

    const err = new Errors.BatchPutFailed()
    err.failed = failed
    err.attempts = tries
    throw err
  }

  function getModelMap ({ models, tableNames }) {
    if (!tableNames) {
      tableNames = getTableBuckets().map(def => def.TableName)
    }

    tableNames.sort(alphabetical)

    const modelToBucket = {}
    Object.keys(models)
      .filter(id => vrUtils.isInstantiable(models[id]))
      .forEach(id => {
        const num = parseInt(sha256(id, 'hex').slice(0, 6), 16)
        const idx = num % tableNames.length
        modelToBucket[id] = tableNames[idx]
      })

    return {
      tableNames,
      models: modelToBucket
    }
  }

  return {
    forEachItem,
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
    getRecordsFromEvent,
    getTableBuckets,
    getModelMap
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
