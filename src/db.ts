import _ from 'lodash'
import dynogels from 'dynogels'
import { TYPE, SIG } from '@tradle/constants'
import { createTable, DB, Table, utils, defaults } from '@tradle/dynamodb'
import AWS from 'aws-sdk'
// import { createMessagesTable } from './messages-table'
import { Env, Logger, Objects, Messages, ITradleObject, ModelStore, AwsApis } from './types'
import { extendTradleObject, pluck, ensureTimestamped, logify, logifyFunction, safeStringify } from './utils'
import { TYPES, UNSIGNED_TYPES } from './constants'
import Errors from './errors'

const { MESSAGE, SEAL_STATE, BACKLINK_ITEM, DELIVERY_ERROR } = TYPES

const ALLOW_SCAN = [
  DELIVERY_ERROR
]

const ALLOW_SCAN_QUERY = [
  SEAL_STATE,
  'tradle.ApplicationSubmission'
].concat(ALLOW_SCAN)

const _allowScan = filterOp => {
  if (filterOp.opType === 'query') {
    return ALLOW_SCAN_QUERY.includes(filterOp.type)
  }

  return ALLOW_SCAN.includes(filterOp.type)
}

const shouldMinify = item => item[TYPE] !== 'tradle.Message' && !UNSIGNED_TYPES.includes(item[TYPE])

const getControlLatestOptions = (table: Table, method: string, resource: any) => {
  if (UNSIGNED_TYPES.includes(resource[TYPE])) return

  if (!resource._link) {
    throw new Errors.InvalidInput('expected "_link"')
  }

  if (method === 'create' && !resource._time) {
    throw new Errors.InvalidInput('expected "_time"')
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

type DBOpts = {
  modelStore: ModelStore
  objects: Objects
  messages: Messages
  aws: AwsApis
  dbUtils: any
  logger: Logger
}

export = function createDB ({
  modelStore,
  objects,
  aws,
  dbUtils,
  messages,
  logger
}: DBOpts) {
  const { docClient, dynamodb } = aws
  dynogels.dynamoDriver(dynamodb)

  const tableBuckets = dbUtils.getTableBuckets()
  const allowScan = filterOp => {
    const allow = _allowScan(filterOp)
    if (allow) logger.debug('allowing scan', filterOp.EQ[TYPE])
    return allow
  }

  const commonOpts = {
    docClient,
    get models() { return modelStore.models },
    get modelsStored() { return modelStore.models },
    objects,
    allowScan,
    shouldMinify
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

  const fixMessageFilter = ({ args }) => {
    const { filter } = args[0]
    if (!(filter && filter.EQ)) return

    const { EQ } = filter
    if (EQ[TYPE] !== MESSAGE) return
    if (EQ._dcounterparty) return

    const _counterparty = EQ._author || EQ._recipient || EQ._counterparty
    if (!(_counterparty && '_inbound' in EQ)) return

    EQ._dcounterparty = messages.getDCounterpartyKey({
      _counterparty,
      _inbound: EQ._inbound
    })

    delete EQ._author
    delete EQ._recipient
    delete EQ._counterparty
    delete EQ._inbound
  }

  const addPayloads = async ({ args, result }) => {
    const { items } = result
    if (!(items && items.length)) return

    const { EQ={} } = args && args[0] && args[0].filter
    if (EQ[TYPE] !== MESSAGE) return

    const msgs = items.map(messages.formatForDelivery)
    const { select=[] } = args[0]
    if (select.includes('object')) {
      const payloads:ITradleObject[] = await Promise.all(msgs.map(msg => objects.get(msg.object._link)))
      payloads.forEach((payload, i) => extendTradleObject(msgs[i].object, payload))
    }

    result.items = msgs
  }

  // const addSegmentAnnotation = (method, type) => {
  //   require('aws-xray-sdk-core').captureFunc('dbputs', subsegment => {
  //     subsegment.annotations['db:puts']
  //   })
  // }

  const onFindPre = async (opts) => {
    fixMessageFilter(opts)
  }

  db.hook('find:pre', onFindPre)
  db.hook('find:post', addPayloads)
  db.hook('batchPut:pre', ({ args }) => args[0].forEach(checkPre))
  db.hook('put:pre', ({ args }) => checkPre(args[0]))

  const checkPre = resource => {
    if (!resource[SIG] && !UNSIGNED_TYPES.includes(resource[TYPE])) {
      throw new Error(`expected resource to be signed: ${resource._link}`)
    }

    ensureTimestamped(resource)
  }

  return logifyDB(db, logger)
}

const logifyDB = (db: DB, logger: Logger) => {
  db.find = logifyFunction({
    logger,
    fn: db.find.bind(db),
    level: 'silly',
    name: opts => `DB.find ${opts.filter.EQ[TYPE]}`,
    // printError: verbosePrint
  })

  db.batchPut = logifyFunction({
    logger,
    fn: db.batchPut.bind(db),
    level: 'silly',
    name: 'DB.batchPut',
    // printError: verbosePrint
  })

  ;['get', 'put', 'del', 'update', 'merge'].forEach(method => {
    db[method] = logifyFunction({
      logger,
      fn: db[method].bind(db),
      level: 'silly',
      name: opts => opts[TYPE] ? `DB.${method} ${opts[TYPE]}` : method,
      // printError: verbosePrint
    })
  })

  return db
}

const verbosePrint = (error, args) => safeStringify({ error, args })
