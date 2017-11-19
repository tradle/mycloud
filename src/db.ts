import { createTable, DB, utils } from '@tradle/dynamodb'
import AWS = require('aws-sdk')
import { createMessagesTable } from './messages-table'

const definitions = require('./definitions')

export = function createDB (opts: {
  models: any,
  objects: any,
  tables: any,
  aws: any,
  constants: any,
  env: any,
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

  const pubKeyModel = models['tradle.PubKey']
  const pubKeysDef = definitions.PubKeysTable.Properties
  db.setExclusive({
    model: pubKeyModel,
    table: createTable({
      ...commonOpts,
      exclusive: true,
      readOnly: !env.TESTING,
      model: pubKeyModel,
      tableDefinition: utils.toDynogelTableDefinition(pubKeysDef)
    })
  })

  const friendModel = models['tradle.MyCloudFriend']
  const friendsDef = definitions.FriendsTable.Properties
  db.setExclusive({
    model: friendModel,
    table: createTable({
      ...commonOpts,
      exclusive: true,
      model: friendModel,
      tableDefinition: utils.toDynogelTableDefinition(friendsDef)
    })
  })

  return db
}
