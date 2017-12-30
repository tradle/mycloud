import dynogels = require('dynogels')
import { createTable, DB, utils } from '@tradle/dynamodb'
import AWS = require('aws-sdk')
import { createMessagesTable } from './messages-table'
import Provider from './provider'
import Friends from './friends'
import { Buckets } from './buckets'
import Env from './env'
import Logger from './logger'
import Tradle from './tradle'

export = function createDB (tradle:Tradle) {
  const { modelStore, objects, tables, provider, aws, constants, env, dbUtils } = tradle

  dynogels.dynamoDriver(aws.dynamodb)

  const tableBuckets = dbUtils.getTableBuckets()
  const commonOpts = {
    get models() {
      return modelStore.models
    },
    objects,
    docClient: aws.docClient,
    maxItemSize: constants.MAX_DB_ITEM_SIZE,
    forbidScan: true,
    defaultReadOptions: {
      ConsistentRead: true
    }
  }

  let modelMap
  const updateModelMap = () => {
    modelMap = dbUtils.getModelMap({ models: modelStore.models })
  }

  modelStore.on('update', updateModelMap)
  updateModelMap()

  const chooseTable = ({ tables, type }) => {
    const tableName = modelMap.models[type]
    return tables.find(table => table.name === tableName)
  }

  const tableNames = tableBuckets.map(({ TableName }) => TableName)
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
  if (!messageModel.isInterface) {
    const messagesTable = createMessagesTable({
      models: modelStore.models,
      getMyIdentity: () => provider.getMyPublicIdentity()
    })

    db.setExclusive({
      model: messageModel,
      table: messagesTable
    })
  }

  ;[
    {
      type: 'tradle.PubKey',
      definition: tables.PubKeys.definition,
    },
    {
      type: 'tradle.MyCloudFriend',
      definition: tables.Friends.definition,
    },
    {
      type: 'tradle.IotSession',
      definition: tables.Presence.definition,
      opts: {
        forbidScan: false
      }
    }
  ].forEach(({ type, definition, opts={} }) => {
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

  return db
}
