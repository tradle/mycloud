import { db as newDB, createTable } from '@tradle/dynamodb'
import AWS = require('aws-sdk')
import { createTable as createMessagesTable } from './messages-table'
// const Tables = require('./tables')

export = function createDB (opts: {
  models: any,
  objects: any,
  tables: any,
  aws: any,
  constants: any,
  env: any,
  prefix: string
}) {
  const { models, objects, tables, aws, constants, env, prefix } = opts
  const db = newDB({
    models,
    objects,
    docClient: aws.docClient,
    maxItemSize: constants.MAX_DB_ITEM_SIZE,
    prefix
  })

  const messageModel = models['tradle.Message']
  if (!messageModel.isInterface) {
    const messagesTable = createMessagesTable({ models, tables, prefix })
    db.setTableForType('tradle.Message', messagesTable)
  }

  const pubKeyModel = models['tradle.PubKey']
  const pubKeys = createTable({
    models: {
      ...models,
      [pubKeyModel.id]: pubKeyModel
    },
    objects,
    model: pubKeyModel,
    tableName: tables.PubKeys.name,
    prefix,
    hashKey: 'pub',
    indexes: []
  })

  db.setTableForType('tradle.PubKey', pubKeys)
  return db
}
