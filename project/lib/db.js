const tradleDynamo = require('@tradle/dynamodb')
const { models, objects, aws, constants, env } = require('./')
// const Tables = require('./tables')

module.exports = function createDB ({ prefix, tables }) {
  const db = tradleDynamo.db({
    models,
    objects,
    docClient: aws.docClient,
    maxItemSize: constants.MAX_DB_ITEM_SIZE,
    prefix
  })

  // export Outbox only
  const messageModel = models['tradle.Message']
  const outbox = tradleDynamo.createTable({
    models,
    objects,
    model: messageModel,
    tableName: tables.Outbox.name,
    prefix,
    // better load these from serverless-yml
    hashKey: '_recipient',
    rangeKey: 'time',
    indexes: []
  })

  db.setTableForType('tradle.Message', outbox)
  return db
}
