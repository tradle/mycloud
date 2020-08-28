import _ from 'lodash'
import dynogels from 'dynogels'
import { createTable, DB, Table, utils, Search, ITableOpts } from '@tradle/dynamodb'
import AWS from 'aws-sdk'
// import { createMessagesTable } from './messages-table'
import { Logger, Objects, Messages, ITradleObject, Model, ModelStore, ClientCache } from './types'
import {
  extendTradleObject,
  pluck,
  logifyFunction,
  safeStringify,
  getPrimaryKeySchema,
  toSortableTag,
  wrapSlowPoke,
  isUnsignedType
} from './utils'

import { TYPE, SIG, ORG, AUTHOR, TYPES, MAX_DB_ITEM_SIZE } from './constants'
import Errors from './errors'

const { MESSAGE, SEAL_STATE, DELIVERY_ERROR } = TYPES
const ORG_OR_AUTHOR = '_orgOrAuthor'
const ARTIFICIAL_PROPS = [ORG_OR_AUTHOR]
const VERSION_INFO = 'tradle.cloud.VersionInfo'
const UPDATE = 'tradle.cloud.Update'
const UPDATE_REQUEST = 'tradle.cloud.UpdateRequest'
const UPDATE_RESPONSE = 'tradle.cloud.UpdateResponse'

const ALLOW_SCAN = [DELIVERY_ERROR]

const ALLOW_SCAN_QUERY = [SEAL_STATE, 'tradle.ApplicationSubmission'].concat(ALLOW_SCAN)

// TODO:
// add whether list should be allowed with additional filter conditions
// which may make it incredibly expensive to fulfil the "limit"
const ALLOW_LIST_TYPE = [
  { type: DELIVERY_ERROR },
  { type: 'tradle.Application' },
  { type: 'tradle.ProductRequest' },
  { type: 'tradle.documentChecker.Check', sortedByDB: true }
]

const isListable = ({ type, sortedByDB }) => {
  const search = { type, sortedByDB }
  return !!ALLOW_LIST_TYPE.find(conditions => _.isMatch(search, conditions))
}

const defaultIndexes = [
  {
    // default for all tradle.Object resources
    hashKey: ORG_OR_AUTHOR,
    rangeKey: ['_t', '_time']
  },
  {
    // default for all tradle.Object resources
    hashKey: TYPE,
    rangeKey: '_time'
  }
]

const deriveProps = opts => {
  let { item } = opts
  item = _.clone(item)
  if (item[ORG] || item[AUTHOR]) {
    item[ORG_OR_AUTHOR] = item[ORG] || item[AUTHOR]
  }

  const props = utils.deriveProps({ ...opts, item })
  // don't store this property
  // only use it to calculate index values
  delete props[ORG_OR_AUTHOR]
  return props
}

// const indexAliases = {
//   get ['$org']() {
//     return {
//       hashKey: '_orgOrAuthor',
//       rangeKey: ['_t', '_time', '_author']
//     }
//   }
// }

const _isScanAllowed = search => {
  if (search.opType === 'query') {
    return ALLOW_SCAN_QUERY.includes(search.type)
  }

  return ALLOW_SCAN.includes(search.type)
}

const shouldMinify = item => item[TYPE] !== 'tradle.Message' && !isUnsignedType(item[TYPE])
// const AUTHOR_INDEX = {
//   // default for all tradle.Object resources
//   hashKey: '_author',
//   rangeKey: '_time'
// }

// const TYPE_INDEX = {
//   // default for all tradle.Object resources
//   hashKey: TYPE,
//   rangeKey: '_time'
// }

// const REQUIRED_INDEXES = [TYPE_INDEX]

const getControlLatestOptions = ({
  table,
  method,
  model,
  resource
}: {
  table: Table
  method: string
  model: Model
  resource: any
}) => {
  if (isUnsignedType(resource[TYPE])) return

  if (!resource._link) {
    throw new Errors.InvalidInput('expected "_link"')
  }

  if (method === 'create' && !resource._time) {
    throw new Errors.InvalidInput('expected "_time"')
  }

  const pk = getPrimaryKeySchema(model)
  if (pk.hashKey !== '_permalink') {
    return
  }

  const options = {
    ConditionExpression: Object.keys(table.primaryKeys)
      .map(keyType => `attribute_not_exists(#${keyType})`)
      .join(' and '),
    ExpressionAttributeNames: Object.keys(table.primaryKeys).reduce((names, keyType) => {
      names[`#${keyType}`] = table.primaryKeys[keyType]
      return names
    }, {}),
    ExpressionAttributeValues: {
      ':link': resource._link
    }
  }

  options.ConditionExpression = `(${options.ConditionExpression}) OR #link = :link`
  options.ExpressionAttributeNames['#link'] = '_link'
  if (typeof resource._time === 'number') {
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
  clients: ClientCache
  dbUtils: any
  logger: Logger
}

export = function createDB({ modelStore, objects, clients, dbUtils, messages, logger }: DBOpts) {
  const docClient = clients.documentclient
  const dynamodb = clients.dynamodb
  dynogels.dynamoDriverAndDocClient(dynamodb, docClient)

  const tableBuckets = dbUtils.getTableBuckets()

  // TODO: merge into validateFind
  const isScanAllowed = (search: Search) => {
    if (search.allowScan === true) return true

    if (search.opType === 'query') {
      if (!search.sortedByDB) {
        // debugger
        logger.error('will soon forbid expensive query', summarizeSearch(search))
      }

      return true
    }

    const allow = _isScanAllowed(search)
    if (allow) logger.debug('allowing scan', search.type)
    return allow
  }

  const validateFind = (search: Search) => {
    if (isScanAllowed(search)) return
    if (!search.index) return

    const { model, index, table } = search
    const idx = table.indexes.findIndex(i => i === index)
    const modelIdx = getIndexesForModel({ table, model })[idx]
    if (!modelIdx) {
      logger.warn('expected corresponding model index', { index, model })
      return
    }

    if (
      modelIdx.hashKey === TYPE &&
      // !search.sortedByDB &&
      !isListable(search)
    ) {
      debugger
      logger.error('will soon forbid expensive query', summarizeSearch(search))
      // throw new Errors.InvalidInput(`your filter/orderBy is too broad, please narrow down your query`)
    }
  }

  const commonOpts: Partial<ITableOpts> = {
    docClient,
    get models() {
      return modelStore.models
    },
    // all models in one table in our case
    get modelsStored() {
      return modelStore.models
    },
    objects,
    allowScan: isScanAllowed,
    shouldMinify,
    deriveProps,
    maxItemSize: MAX_DB_ITEM_SIZE
  }

  const getIndexesForModel = ({ table, model }) => {
    if (model.indexes) return model.indexes.slice()

    return _.cloneDeep(defaultIndexes)

    // throw new Error(`failed to get indexes for model: ${model.id}`)
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
  const db = new DB({
    // modelStore needs to become an interface
    // @ts-ignore
    modelStore,
    tableNames,
    defineTable: name => {
      const cloudformation: AWS.DynamoDB.CreateTableInput =
        tableBuckets[tableNames.indexOf(name)].Properties
      const table = createTable({
        ...commonOpts,
        tableDefinition: cloudformation,
        // all key props are derived
        derivedProps: pluck(cloudformation.AttributeDefinitions, 'AttributeName'),
        getIndexesForModel
      } as ITableOpts)

      table.find = wrapSlowPoke({
        fn: table.find.bind(table),
        time: 5000,
        onSlow: ({ time, args, stack }) => {
          logger.error('db query took more than 5s', { time, args, stack })
        }
      })

      const controlLatestHooks = method => async ({ args }) => {
        const [resource, options] = args
        if (!options) {
          args[1] = getControlLatestOptions({
            table,
            method,
            model: modelStore.models[resource[TYPE]],
            resource
          })
        }
      }
      ;['put', 'update'].forEach(method => {
        table.hook(`${method}:pre`, controlLatestHooks(method))
      })

      table.hook('pre:find:validate', op => {
        validateFind(op)
      })

      table.hook('find:pre', preProcessSearch)
      table.hook('find:post', postProcessSearchResult)
      table.hook('batchPut:pre', ({ args }) => args[0].forEach(checkPre))
      table.hook('put:pre', ({ args }) => checkPre(args[0]))

      return table
    },
    chooseTable
  })

  const fixMessageFilter = ({ EQ }) => {
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

  const fixVersionInfoFilter = ({ GT, LT }) => {
    ;[GT, LT].forEach(conditions => {
      if (!conditions) return

      if (conditions.tag && !conditions.sortableTag) {
        conditions.sortableTag = toSortableTag(conditions.tag)
        delete conditions.tag
      }
    })
  }

  // const stripArtificialProps = items => items.map(item => _.omit(item, ARTIFICIAL_PROPS))

  const postProcessSearchResult = async ({ args = [], result }) => {
    const { items } = result
    if (!(items && items.length)) return

    const opts = args[0] || {}
    const { EQ = {} } = opts.filter

    // if (!opts.keepDerivedProps) {
    //   result.items = items = stripArtificialProps(items)
    // }

    if (EQ[TYPE] !== MESSAGE) return

    const msgs = items.map(messages.formatForDelivery)
    const { select } = opts
    if (!select || select.includes('object')) {
      const payloads: ITradleObject[] = await Promise.all(
        msgs.map(msg => objects.get(msg.object._link))
      )
      payloads.forEach((payload, i) => extendTradleObject(msgs[i].object, payload))
    }

    result.items = msgs
  }

  // const addSegmentAnnotation = (method, type) => {
  //   require('aws-xray-sdk-core').captureFunc('dbputs', subsegment => {
  //     subsegment.annotations['db:puts']
  //   })
  // }

  const preProcessSearch = async opts => {
    const { args } = opts
    const { filter } = args[0]
    if (!(filter && filter.EQ)) return

    const type = filter.EQ[TYPE]
    if (type === MESSAGE) fixMessageFilter(filter)
    if (
      type === VERSION_INFO ||
      type === UPDATE ||
      type === UPDATE_REQUEST ||
      type === UPDATE_RESPONSE
    ) {
      fixVersionInfoFilter(filter)
    }
  }

  const checkPre = resource => {
    if (!resource[SIG] && !isUnsignedType(resource[TYPE])) {
      throw new Error(`expected resource to be signed: ${resource._link}`)
    }

    // if (typeof resource[TIMESTAMP] !== 'number') {
    // throw new Errors.InvalidInput(`expected "${TIMESTAMP}"`)
    // }
  }

  return logifyDB(db, logger)
  // return db
}

const logifyDB = (db: DB, logger: Logger) => {
  db.find = logifyFunction({
    logger,
    fn: db.find.bind(db),
    level: 'silly',
    name: opts => `DB.find ${opts.filter.EQ[TYPE]}`
    // printError: verbosePrint
  })

  db.batchPut = logifyFunction({
    logger,
    fn: db.batchPut.bind(db),
    level: 'silly',
    name: 'DB.batchPut'
    // printError: verbosePrint
  })
  ;['get', 'put', 'del', 'update', 'merge'].forEach(method => {
    db[method] = logifyFunction({
      logger,
      fn: db[method].bind(db),
      level: 'silly',
      name: opts => (opts[TYPE] ? `DB.${method} ${opts[TYPE]}` : method)
      // printError: verbosePrint
    })
  })

  return db
}

// const verbosePrint = (error, args) => safeStringify({ error, args })

const summarizeSearch = (op: Search) => _.pick(op, ['filter', 'orderBy', 'limit'])
