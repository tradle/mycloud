import { createTable, DB, utils } from '@tradle/dynamodb'
import AWS = require('aws-sdk')
import { createMessagesTable } from './messages-table'
import Provider from './provider'
import Env from './env'

export = function createDB (opts: {
  models: any,
  objects: any,
  tables: any,
  provider: Provider,
  aws: any,
  constants: any,
  env: Env,
  dbUtils: any
}) {
  const { models, objects, tables, provider, aws, constants, env, dbUtils } = opts
  const tableBuckets = dbUtils.getTableBuckets()

  let modelMap = dbUtils.getModelMap({ models })
  const chooseTable = ({ tables, type }) => {
    const tableName = modelMap.models[type]
    return tables.find(table => table.name === tableName)
  }

  const commonOpts = {
    models,
    objects,
    docClient: aws.docClient,
    maxItemSize: constants.MAX_DB_ITEM_SIZE,
    forbidScan: true,
    defaultReadOptions: {
      consistentRead: true
    }
  }

  const tableNames = tableBuckets.map(({ TableName }) => TableName)
  const db = new DB({
    models,
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

  db.on('update:models', ({ models }) => {
    commonOpts.models = models
    modelMap = dbUtils.getModelMap({ models })
  })

  const messageModel = models['tradle.Message']
  if (!messageModel.isInterface) {
    const messagesTable = createMessagesTable({
      models,
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
    const model = models[type]
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
