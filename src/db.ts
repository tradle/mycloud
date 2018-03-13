import _ from 'lodash'
import dynogels from 'dynogels'
import { TYPE } from '@tradle/constants'
import { createTable, DB, utils } from '@tradle/dynamodb'
import AWS from 'aws-sdk'
// import { createMessagesTable } from './messages-table'
import { Provider, Friends, Buckets, Env, Logger, Tradle, ITradleObject } from './types'
import { extendTradleObject } from './utils'

const MESSAGE = 'tradle.Message'

export = function createDB (tradle:Tradle) {
  const { modelStore, objects, tables, aws, constants, env, dbUtils } = tradle

  const { docClient, dynamodb } = aws
  dynogels.dynamoDriver(dynamodb)

  const tableBuckets = dbUtils.getTableBuckets()
  const commonOpts = {
    get models() {
      return modelStore.models
    },
    objects,
    docClient,
    maxItemSize: constants.MAX_DB_ITEM_SIZE,
    forbidScan: true,
    defaultReadOptions: {
      consistentRead: true
    }
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
      const cloudformation = tableBuckets[tableNames.indexOf(name)]
      return createTable({
        ...commonOpts,
        tableDefinition: utils.toDynogelTableDefinition(cloudformation)
      })
    },
    chooseTable
  })

  const messageModel = modelStore.models['tradle.Message']
  // const messagesTable = createMessagesTable({
  //   docClient,
  //   models: modelStore.models,
  //   getMyIdentity: () => tradle.provider.getMyPublicIdentity(),
  //   definitions: dbUtils.definitions
  // })

  ;[
    {
      type: 'tradle.Message',
      definition: tables.Messages.definition,
      opts: {
        forbidScan: true
      }
    },
    {
      type: 'tradle.PubKey',
      definition: tables.PubKeys.definition,
      opts: {}
    },
    {
      type: 'tradle.MyCloudFriend',
      definition: tables.Friends.definition,
      opts: {}
    },
    {
      type: 'tradle.IotSession',
      definition: tables.Presence.definition,
      opts: {
        forbidScan: false
      }
    },
    // {
    //   type: 'tradle.cloud.Event',
    //   definition: tables.Events.definition,
    //   opts: {
    //     forbidScan: true
    //   }
    // }
    // {
    //   type: 'tradle.Seal',
    //   definition: tables.Seals.definition
    // }
  ].forEach(typeConf => {
    const { type, definition, opts } = typeConf
    const model = modelStore.models[type]
    db.setExclusive({
      model,
      table: createTable({
        ...commonOpts,
        exclusive: true,
        // readOnly: !env.TESTING,
        model,
        tableDefinition: utils.toDynogelTableDefinition(definition),
        ...opts
      })
    })
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
    let messages = result.items
    if (!(messages && messages.length)) return

    messages = messages.map(tradle.messages.formatForDelivery)
    const { select=[] } = args[0]
    if (select.includes('object')) {
      const payloads:ITradleObject[] = await Promise.all(messages.map(msg => objects.get(msg.object._link)))
      payloads.forEach((payload, i) => extendTradleObject(messages[i].object, payload))
    }

    result.items = messages
  }

  db.hook('find:pre', fixMessageFilter)
  db.hook('find:post', addPayloads)

  return db
}
