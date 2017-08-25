/**
 * Deletes tables that were dynamically generated for per-data-model
 */

const co = require('co')
const { dynamodb } = require('../project/lib/aws')
const { batchify } = require('../project/lib/utils')
const { SERVERLESS_PREFIX } = require('../service-map')
const {
  service: {
    resources: { Resources }
  }
} = require('../.serverless/serverless-state')

const tablesToKeep = Object.keys(Resources)
  .map(key => Resources[key])
  .filter(resource => resource.Type === 'AWS::DynamoDB::Table')
  .map(table => table.Properties.TableName)

co(function* () {
  const { TableNames } = yield dynamodb.listTables().promise()
  const toDelete = TableNames.filter(name => {
    return !tablesToKeep.includes(name)
  })

  console.log('deleting', toDelete)
  const batches = batchify(toDelete, 10)
  for (const batch of batches) {
    console.log(batch)
    yield batch.map(TableName => dynamodb.deleteTable({ TableName }).promise())
  }

  console.log('deleted', toDelete)
})
.catch(console.error)
