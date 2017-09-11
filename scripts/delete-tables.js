#!/usr/bin/env node

/**
 * Deletes tables that were dynamically generated for per-data-model
 */

const co = require('co')
const { dynamodb } = require('../project/lib/aws')
const { batchify, runWithBackoffWhile } = require('../project/lib/utils')
const { SERVERLESS_PREFIX } = require('../project/test/service-map')
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

  if (!toDelete) return

  console.log('deleting', toDelete)

  for (const TableName of TableNames) {
    console.log(`deleting ${TableName}`)
    runWithBackoffWhile(co.wrap(function* () {
      yield dynamodb.deleteTable({ TableName }).promise()
    }), {
      shouldTryAgain: err => err.name === 'LimitExceededException',
      initialDelay: 1000,
      maxDelay: 10000,
      maxTime: 5 * 60 * 1000
    })
  }

  console.log('deleted', toDelete)
})
.catch(console.error)
