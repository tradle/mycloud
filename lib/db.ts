import { db as newDB, createTable } from '@tradle/dynamodb'
import AWS = require('aws-sdk')
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

  // export Outbox only
  const messageModel = models['tradle.Message']
  if (!messageModel.isInterface) {
    const outbox = createTable({
      models,
      objects,
      model: messageModel,
      tableName: tables.Outbox.name,
      prefix,
      // better load these from serverless-yml
      hashKey: '_recipient',
      rangeKey: 'time',
      indexes: [
        {
          hashKey: '_payloadLink',
          rangeKey: 'time',
          name: 'PayloadLinkIndex',
          type: 'global',
          projection: {
            ProjectionType: 'KEYS_ONLY'
          }
        }
      ]
    })

    db.setTableForType('tradle.Message', outbox)
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
