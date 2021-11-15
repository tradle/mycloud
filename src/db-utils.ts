const debug = require('debug')('tradle:sls:db-utils')
// @ts-ignore
import Promise from 'bluebird'
import AWS from 'aws-sdk'
import { AttributePath, PathElement } from '@aws/dynamodb-expressions'
import _ from 'lodash'
// import {
//   marshalItem as marshallDBItem,
//   unmarshalItem as unmarshallDBItem
// } from 'dynamodb-marshaler'

import dynogels from '@tradle/dynogels'
import { utils as vrUtils } from '@tradle/validate-resource'
import { Level } from './logger'
import { NotFound } from './errors'
import { wait, waitImmediate, traverse, defineGetter, noop } from './utils'

import { prettify, alphabetical, format } from './string-utils'
import { sha256 } from './crypto'
import Errors from './errors'
import { Env, StreamRecordType, IStreamRecord, Logger, IServiceMap, ClientCache } from './types'

export type PropPath = string | string[]
export type PathAndValuePair = [PropPath, any]

const { marshall, unmarshall } = AWS.DynamoDB.Converter
const marshallDBItem = item => marshall(item)
const unmarshallDBItem = item => fixUnmarshallItem(unmarshall(item))
const fixUnmarshallItem = item =>
  traverse(item).map(function(value) {
    // unwrap Set instances
    if (value && value.values && !Array.isArray(value) && value.constructor !== Object) {
      this.update(value.values)
    }
  })

// const marshallDBItem = marshall
// const unmarshallDBItem = unmarshall

type Batch = {
  Items: any[]
  LastEvaluatedKey?: any
}

type BackoffOptions = {
  backoff: (tries: number) => number
  maxTries: number
}

type BatchWorker = (batch: Batch) => Promise<boolean | void>
type ItemWorker = (item: any) => Promise<boolean | void>

const alwaysTrue = (...any) => true
const MAX_BATCH_SIZE = 25
const CONSISTENT_READ_EVERYTHING = true
const defaultBackoffFunction = (retryCount: number) => {
  const delay = Math.pow(2, retryCount) * 500
  return Math.min(jitter(delay, 0.1), 10000)
}

const DEFAULT_BACKOFF_OPTS = {
  backoff: defaultBackoffFunction,
  maxTries: 6
}

export default createDBUtils
export {
  createDBUtils,
  getRecordsFromEvent,
  getTableNameFromStreamEvent,
  getUpdateParams,
  marshallDBItem,
  unmarshallDBItem
}

const renderDefinitions = ({
  definitions,
  serviceMap
}: {
  definitions: any
  serviceMap: IServiceMap
}) => {
  definitions = _.cloneDeep(definitions)
  _.forEach(definitions, (resource, logicalId) => {
    if (resource.Type === 'AWS::DynamoDB::Table') {
      resource.Properties.TableName = serviceMap.Table[logicalId]
    }
  })

  return definitions
}

function createDBUtils({
  aws,
  logger,
  env,
  serviceMap
}: {
  aws: ClientCache
  logger: Logger
  env: Env
  serviceMap: IServiceMap
}) {
  const getDefinitions = _.memoize(() =>
    renderDefinitions({
      definitions: require('./definitions'),
      serviceMap
    })
  )

  const getTableBuckets = _.memoize(() => [getDefinitions().Bucket0])

  const getCachedDefinition = tableName => {
    const definitions = getDefinitions()
    const logicalId = Object.keys(definitions).find(logicalId => {
      return definitions[logicalId].Properties.TableName === tableName
    })

    return logicalId && definitions[logicalId].Properties
  }

  const { debug } = logger
  const dynogelsLogger = logger.sub('dynogels')
  if (logger.level >= Level.WARN) {
    const level = logger.level >= Level.SILLY ? 'info' : 'warn'
    dynogels.log = {
      info: noop,
      warn: (...data) => dynogelsLogger.warn('', data),
      level: 'warn'
    }
  }

  function getTable(TableName) {
    const batchWriteToTable = async ops => {
      ops.forEach(({ type }) => {
        if (type !== 'put' && type !== 'del') {
          throw new Error(`expected "type" to be either "put" or "del", got ${type}`)
        }
      })

      const batches = _.chunk(ops, MAX_BATCH_SIZE)
      for (const batch of batches) {
        debug(`writing batch of ${batch.length} to ${TableName}`)
        await batchPut({
          RequestItems: {
            [TableName]: batch.map(({ type, value }) => {
              const reqType = type === 'put' ? 'PutRequest' : 'DeleteRequest'
              return {
                [reqType]: { Item: value }
              }
            })
          }
        })
      }
    }

    const batchPutToTable = async items => {
      const ops = items.map(value => ({ type: 'put', value }))
      return batchWriteToTable(ops)
    }

    const batchDeleteFromTable = async items => {
      const ops = items.map(value => ({ type: 'del', value }))
      return batchWriteToTable(ops)
    }

    const tableAPI: any = {
      toString: () => TableName,
      batchWrite: batchWriteToTable,
      batchPut: batchPutToTable,
      batchDelete: batchDeleteFromTable
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
      queryOne: findOne
    }

    // aliases
    Object.keys(api).forEach(method => {
      tableAPI[method] = (params: any = {}) => {
        params.TableName = TableName
        return api[method](params)
      }
    })

    tableAPI.client = aws.documentclient
    tableAPI.rawClient = aws.dynamodb
    tableAPI.name = TableName
    defineGetter(tableAPI, 'definition', () => getCachedDefinition(TableName))
    tableAPI.batchProcess = ({ params = {}, ...opts }) => {
      return batchProcess({
        params: { ...params, TableName },
        ...opts
      })
    }

    tableAPI.clear = () => clear(TableName)
    tableAPI.getTableDefinition = () => getTableDefinition(TableName)
    return tableAPI // timeMethods(tableAPI, logger)
  }

  /**
   * @param {Array} items [{ tableName, key }]
   * @param {Object?} opts
   */
  // const batchGet = async (items, opts={}) => {
  //   const {
  //     backoff,
  //     maxTries
  //   } = _.defaults(opts.backoffOptions || {}, DEFAULT_BACKOFF_OPTS)

  //   const batches = _.chunk(items, 100)
  //   const params:AWS.DynamoDB.DocumentClient.BatchGetItemInput = {
  //     RequestItems: {}
  //   }

  //   return await Promise.mapSeries(batches, async (batch:any[]) => {
  //     let lastEvaluatedKey = true
  //     let retry = true
  //     let result
  //     params.RequestItems = batch.reduce((ri, item) => {
  //       const { tableName, key } = item
  //       if (!ri[tableName]) {
  //         ri[tableName] = { Keys: [] }
  //       }

  //       ri[tableName].Keys.push({ Name: key })
  //       return ri
  //     }, {})

  //     while (lastEvaluatedKey || retry) {
  //       result = await exec('batchGet', params)
  //       failed = result.UnprocessedItems
  //       if (!(failed && Object.keys(failed).length > 0)) return

  //       params.RequestItems = failed
  //       await wait(backoff(tries++))
  //     }
  //   })
  // }

  const execWhile = async (method, params, filter) => {
    while (true) {
      try {
        return await exec(method, params)
      } catch (err) {
        if (!filter(err)) throw err
      }
    }
  }

  const exec = async (method, params) => {
    // params.ReturnConsumedCapacity = 'TOTAL'
    try {
      const result = await aws.documentclient[method](params).promise()
      // logCapacityConsumption(method, result)
      return result
    } catch (err) {
      Errors.rethrow(err, 'system')
      if (err.code === 'ValidationException') {
        Errors.rethrowAs(err, new Errors.InvalidInput(err.message))
      }

      // if (err.code === 'ConditionalCheckFailedException') {
      //   console.log(params)
      //   debugger
      // }

      throw err
    }
  }

  const dynamoDBExec = function dynamoDBExec(method, params) {
    return aws.dynamodb[method](params).promise()
  }

  const createTable = params => dynamoDBExec('createTable', params)
  const deleteTable = params => dynamoDBExec('deleteTable', params)

  const batchProcess = async ({
    params,
    processOne,
    processBatch
  }: {
    params: any
    processOne?: ItemWorker
    processBatch?: BatchWorker
  }) => {
    const method = params.KeyConditionExpression ? 'query' : 'scan'
    let lastEvaluatedKey = null
    let retry = true
    let keepGoing: boolean | void = true
    let response
    while (keepGoing && (lastEvaluatedKey || retry)) {
      try {
        // @ts-ignore
        response = await aws.docClient[method](params).promise()
      } catch (err) {
        if (err.retryable) {
          retry = true
          await waitImmediate()
          continue
        }

        retry = false
        throw err
      }

      retry = false
      lastEvaluatedKey = response.LastEvaluatedKey
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey
      } else {
        delete params.ExclusiveStartKey
      }

      if (processBatch) {
        keepGoing = await processBatch(response)
      } else {
        const results = await Promise.all(response.Items.map(item => processOne(item)))
        keepGoing = results.every(result => result !== false)
      }
    }
  }

  const getTableDefinition = async (TableName: string) => {
    const definitions = getDefinitions()
    if (definitions[TableName]) return definitions[TableName]

    const { Table } = await aws.dynamodb.describeTable({ TableName }).promise()
    return Table
  }

  const clear = async (TableName: string, filter: Function = alwaysTrue): Promise<number> => {
    const { KeySchema } = await getTableDefinition(TableName)
    const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
    let count = 0
    await batchProcess({
      params: { TableName },
      processOne: async item => {
        if (!filter(item)) return

        await execWhile(
          'delete',
          {
            TableName,
            Key: _.pick(item, keyProps)
          },
          err => err.code === 'LimitExceededException' || err.code === 'ResourceNotFoundException'
        )

        count++
      }
    })

    return count
  }

  const listTables = async (env: Env) => {
    let tables: string[] = []
    let opts: AWS.DynamoDB.ListTablesInput = {}
    while (true) {
      let { TableNames, LastEvaluatedTableName } = await aws.dynamodb.listTables(opts).promise()

      tables = tables.concat(TableNames)
      if (!TableNames.length || !LastEvaluatedTableName) {
        break
      }

      opts.ExclusiveStartTableName = LastEvaluatedTableName
    }

    return tables.filter(name => name.startsWith(env.STACK_RESOURCE_PREFIX))
  }

  const get = async (params: AWS.DynamoDB.GetItemInput) => {
    maybeForceConsistentRead(params)
    const result = await exec('get', params)
    if (!result.Item) {
      throw new NotFound(JSON.stringify(_.pick(params, ['TableName', 'Key'])))
    }

    // debug(`got item from ${params.TableName}: ${prettify(result)}`)
    return fixUnmarshallItem(result.Item)
  }

  const put = async (params: AWS.DynamoDB.PutItemInput) => {
    const result = await exec('put', params)
    return tweakReturnValue(params, result)
  }

  const del = async (params: AWS.DynamoDB.DeleteItemInput) => {
    const result = await exec('delete', params)
    return tweakReturnValue(params, result)
  }

  const find = async (params: AWS.DynamoDB.QueryInput) => {
    maybeForceConsistentRead(params)
    const result = await exec('query', params)
    return result.Items.map(fixUnmarshallItem)
  }

  const findOne = async (params: AWS.DynamoDB.QueryInput) => {
    params.Limit = 1
    const results = await find(params)
    if (!results.length) {
      throw new NotFound(`"${params.TableName}" query returned 0 items`)
    }

    return results[0]
  }

  const update = async (params: AWS.DynamoDB.UpdateItemInput) => {
    const result = await exec('update', params)
    return tweakReturnValue(params, result)
  }

  function maybeForceConsistentRead(params) {
    // ConsistentRead not supported on GlobalSecondaryIndexes
    if (CONSISTENT_READ_EVERYTHING && !params.IndexName && !params.ConsistentRead) {
      params.ConsistentRead = true
      logger.info('forcing consistent read')
    }
  }

  function tweakReturnValue(params, result) {
    if (params.ReturnValues !== 'NONE') {
      return result.Attributes
    }

    return result
  }

  const scan = async (params: AWS.DynamoDB.ScanInput) => {
    maybeForceConsistentRead(params)
    const { Items } = await exec('scan', params)
    return Items
  }

  const rawBatchPut = async (params: AWS.DynamoDB.BatchWriteItemInput) => {
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

  const batchPut = async (
    params: AWS.DynamoDB.BatchWriteItemInput,
    backoffOptions?: BackoffOptions,
    processFailedItems = _.identity
  ) => {
    params = { ...params }

    const { backoff, maxTries } = _.defaults(backoffOptions, DEFAULT_BACKOFF_OPTS)

    let tries = 0
    let failed
    while (tries < maxTries) {
      let result = await rawBatchPut(params)
      failed = result.UnprocessedItems
      if (!(failed && Object.keys(failed).length > 0)) return

      params.RequestItems = processFailedItems(failed)
      await wait(backoff(tries++))
    }

    const err: any = new Errors.BatchPutFailed()
    err.failed = failed
    err.attempts = tries
    throw err
  }

  function getModelMap({ types, models, tableNames }) {
    if (!tableNames) {
      tableNames = getTableBuckets().map(def => def.TableName)
    }

    tableNames.sort(alphabetical)

    const modelToBucket = {}
    if (!types) {
      types = Object.keys(models).filter(id => vrUtils.isInstantiable(models[id]))
    }

    types.forEach(id => {
      const num = parseInt(sha256(id, 'hex').slice(0, 6), 16)
      const idx = num % tableNames.length
      modelToBucket[id] = tableNames[idx]
    })

    return {
      tableNames,
      models: modelToBucket
    }
  }

  const dbUtils = {
    batchProcess,
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
    marshallDBItem,
    unmarshallDBItem,
    getTable,
    getRecordsFromEvent,
    getTableNameFromStreamEvent,
    getTableBuckets,
    getModelMap,
    getTableDefinition,
    get definitions() {
      return getDefinitions()
    }
  }

  return dbUtils
  // return timeMethods(dbUtils, logger)
}

function jitter(val, percent) {
  // jitter by val * percent
  // eslint-disable-next-line no-mixed-operators
  return val * (1 + 2 * percent * Math.random() - percent)
}

function getRecordsFromEvent(event: any): IStreamRecord[] {
  return event.Records.map(record => {
    const { eventName, eventID, eventSourceARN, dynamodb } = record
    const {
      Keys,
      NewImage,
      OldImage,
      ApproximateCreationDateTime
    } = dynamodb as AWS.DynamoDBStreams.StreamRecord

    return {
      id: eventID,
      type: getEventType(eventName),
      time: ApproximateCreationDateTime,
      service: 'dynamodb',
      source: getTableNameFromStreamEvent(event),
      old: OldImage && unmarshallDBItem(OldImage),
      value: NewImage && unmarshallDBItem(NewImage)
    }
  })
}

const getEventType = (eventName: AWS.DynamoDBStreams.OperationType): StreamRecordType => {
  if (eventName === 'INSERT') {
    return 'create'
  }

  if (eventName === 'MODIFY') {
    return 'update'
  }

  if (eventName === 'REMOVE') {
    return 'delete'
  }

  return 'unknown:' + eventName
}

const EVENT_SOURCE_ARN_TABLE_NAME_REGEX = /:table\/([^/]+)/

function getTableNameFromStreamEvent(event) {
  return event.Records[0].eventSourceARN.match(EVENT_SOURCE_ARN_TABLE_NAME_REGEX)[1]
}

function logCapacityConsumption(method, result) {
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

const getUpdateParams = (item): any => {
  const keys = Object.keys(item)
  const toSet = keys.filter(key => item[key] != null)
  const toRemove = keys.filter(key => item[key] == null)

  let UpdateExpression = ''
  if (toSet.length) {
    const ops = toSet.map(key => `#${key} = :${key}`).join(', ')
    UpdateExpression += `SET ${ops} `
  }

  if (toRemove.length) {
    debug(`removing properties: ${toRemove.join(', ')}`)
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

export const toAttributePath = (path: PropPath) => {
  const parts = [].concat(path).map(name => ({
    type: 'AttributeName',
    name
  })) as PathElement[]

  return new AttributePath(parts)
}
