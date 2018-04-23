import _ from 'lodash'
import dynogels from 'dynogels'
import { TYPE, SIG } from '@tradle/constants'
import { createTable, DB, Table, utils, defaults } from '@tradle/dynamodb'
import AWS from 'aws-sdk'
// import { createMessagesTable } from './messages-table'
import { Provider, Friends, Buckets, Env, Logger, Tradle, ITradleObject } from './types'
import { extendTradleObject, pluck } from './utils'
import { TYPES, UNSIGNED_TYPES } from './constants'

const { MESSAGE, SEAL_STATE, BACKLINK_ITEM, DELIVERY_ERROR } = TYPES
const ALLOW_SCAN_QUERY = [
  SEAL_STATE,
  'tradle.ApplicationSubmission'
]

const ALLOW_SCAN = [
  DELIVERY_ERROR
]

const getControlLatestOptions = (table: Table, method: string, resource: any) => {
  if (UNSIGNED_TYPES.includes(resource[TYPE])) return

  if (!resource._link) {
    throw new Error('expected "_link"')
  }

  if (method === 'create' && !resource._time) {
    throw new Error('expected "_time"')
  }

  const options = {
    ConditionExpression: Object.keys(table.primaryKeys)
      .map(keyType => `attribute_not_exists(#${keyType})`)
      .join(' and '),
    ExpressionAttributeNames: Object.keys(table.primaryKeys)
      .reduce((names, keyType) => {
        names[`#${keyType}`] = table.primaryKeys[keyType]
        return names
      }, {}),
    ExpressionAttributeValues: {
      ':link': resource._link
    }
  }

  options.ConditionExpression = `(${options.ConditionExpression}) OR #link = :link`
  options.ExpressionAttributeNames['#link'] = '_link'
  if (resource._time) {
    options.ConditionExpression += ' OR #time < :time'
    options.ExpressionAttributeNames['#time'] = '_time'
    options.ExpressionAttributeValues[':time'] = resource._time
  }

  return options
}

export = function createDB (tradle:Tradle) {
  const { modelStore, objects, tables, aws, constants, env, dbUtils } = tradle

  const { docClient, dynamodb } = aws
  dynogels.dynamoDriver(dynamodb)

  const tableBuckets = dbUtils.getTableBuckets()
  const commonOpts = {
    docClient,
    get models() { return modelStore.models },
    get modelsStored() { return modelStore.models },
    objects,
    allowScan: filterOp => {
      if (filterOp.opType === 'query') {
        return ALLOW_SCAN_QUERY.includes(filterOp.type)
      }

      return ALLOW_SCAN.includes(filterOp.type)
    },
    shouldMinify: item => !UNSIGNED_TYPES.includes(item[TYPE])
    // derivedProps: tableKeys,
  }

  const getIndexesForModel = ({ table, model }) => {
    if (UNSIGNED_TYPES.includes(model.id)) {
      return model.indexes || []
    }

    if (model.id === MESSAGE) {
      return model.indexes
    }

    if (model.id in modelStore.models) {
      return defaults.indexes.concat(model.indexes || [])
    }

    throw new Error(`failed to get indexes for model: ${model.id}`)
  }

  let modelMap
  const updateModelMap = () => {
    modelMap = dbUtils.getModelMap({ models: modelStore.models })
  }

  modelStore.on('update', updateModelMap)
  updateModelMap()

  const chooseTable = ({ tables, type }) => {
    if (tables.length === 1) return tables[0]

    const tableName = modelMap.models[type]
    return tables.find(table => table.name === tableName)
  }

  const tableNames = tableBuckets.map(({ TableName }) => TableName)
  // @ts-ignore
  const db = new DB({
    modelStore,
    tableNames,
    defineTable: name => {
      const cloudformation:AWS.DynamoDB.CreateTableInput = tableBuckets[tableNames.indexOf(name)]
      const table = createTable({
        ...commonOpts,
        tableDefinition: cloudformation,
        // all key props are derived
        derivedProps: pluck(cloudformation.AttributeDefinitions, 'AttributeName'),
        getIndexesForModel
      })

      const controlLatestHooks = method => async ({ args }) => {
        let [resource, options] = args
        if (!options) {
          args[1] = getControlLatestOptions(table, method, resource)
        }
      }

      ;['put', 'update'].forEach(method => {
        table.hook(`${method}:pre`, controlLatestHooks(method))
      })

      return table
    },
    chooseTable
  })


  const fixMessageFilter = async ({ args }) => {
    const { filter } = args[0]
    if (!(filter && filter.EQ)) return

    const { EQ } = filter
    if (EQ[TYPE] !== MESSAGE) return
    if (EQ._dcounterparty) return

    const _counterparty = EQ._author || EQ._recipient || EQ._counterparty
    if (!(_counterparty && '_inbound' in EQ)) return

    EQ._dcounterparty = tradle.messages.getDCounterpartyKey({
      _counterparty,
      _inbound: EQ._inbound
    })

    delete EQ._author
    delete EQ._recipient
    delete EQ._inbound
  }

  const addPayloads = async ({ args, result }) => {
    const { items } = result
    if (!(items && items.length)) return

    const { EQ={} } = args && args[0] && args[0].filter
    if (EQ[TYPE] !== MESSAGE) return

    const messages = items.map(tradle.messages.formatForDelivery)
    const { select=[] } = args[0]
    if (select.includes('object')) {
      const payloads:ITradleObject[] = await Promise.all(messages.map(msg => objects.get(msg.object._link)))
      payloads.forEach((payload, i) => extendTradleObject(messages[i].object, payload))
    }

    result.items = messages
  }

  db.hook('find:pre', fixMessageFilter)
  db.hook('find:post', addPayloads)
  db.hook('batchPut:pre', ({ args }) => args[0].forEach(checkSigned))
  db.hook('put:pre', ({ args }) => checkSigned(args[0]))

  const checkSigned = resource => {
    if (!resource[SIG] && !UNSIGNED_TYPES.includes(resource[TYPE])) {
      throw new Error(`expected resource to be signed: ${resource._link}`)
    }
  }

  return db
}
