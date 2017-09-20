const tradleDynamo = require('@tradle/dynamodb')
const { models, objects, aws, constants, env } = require('./')

module.exports = () => tradleDynamo.db({
  models,
  objects,
  docClient: aws.docClient,
  maxItemSize: constants.MAX_DB_ITEM_SIZE,
  prefix: env.SERVERLESS_PREFIX
})
