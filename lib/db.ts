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
  const { models, objects, tables, aws, constants, env, dbUtils } = opts
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

  const db = new DB({
    tableNames: modelMap.tableNames,
    tableOpts: {
      ...commonOpts,
      tableDefinition: utils.toDynogelTableDefinition(tableBuckets[0])
    },
    chooseTable
  })

  db.on('update:models', ({ models }) => {
    modelMap = dbUtils.getModelMap({ models })
  })

  const messageModel = models['tradle.Message']
  if (!messageModel.isInterface) {
    const messagesTable = createMessagesTable({ models, tables })
    db.setExclusive({
      model: messageModel,
      table: messagesTable
    })
  }

  const pubKeyModel = models['tradle.PubKey']
  const pubKeysDef = definitions.PubKeysTable.Properties
  db.setExclusive({
    model: models['tradle.PubKey'],
    table: createTable(pubKeysDef.TableName, {
      ...commonOpts,
      model: models['tradle.PubKey'],
      tableDefinition: utils.toDynogelTableDefinition(pubKeysDef)
    })
  })

  return db
}
