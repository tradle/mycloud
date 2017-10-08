#!/usr/bin/env node

/**
 * Deletes tables that were dynamically generated for per-data-model
 */

const co = require('co')
const { dynamodb } = require('../lib/aws')
const { batchify, runWithBackoffWhile } = require('../lib/utils')
const { service, stage, profile } = require('minimist')(process.argv.slice(2))
if (!(service && stage)) {
  throw new Error('expected "--service", "--stage" and "--profile"')
}

const { loadCredentials } = require('../lib/cli/utils')
const serviceStageRegExp = new RegExp(`^${service}-${stage}-`)
const {
  service: {
    resources: { Resources }
  }
} = require('../.serverless/serverless-state')

loadCredentials()

const tablesToKeep = Object.keys(Resources)
  .map(key => Resources[key])
  .filter(resource => resource.Type === 'AWS::DynamoDB::Table')
  .map(table => table.Properties.TableName)

co(function* () {
  const { TableNames } = yield dynamodb.listTables().promise()
  const toDelete = TableNames.filter(name => {
    return !tablesToKeep.includes(name) && serviceStageRegExp.test(name)
  })

  if (!toDelete.length) return

  console.log('deleting', toDelete)

  for (const TableName of TableNames) {
    console.log(`deleting ${TableName}`)
    runWithBackoffWhile(co.wrap(function* () {
      yield dynamodb.deleteTable({ TableName }).promise()
    }), {
      shouldTryAgain: err => {
        const willRetry = err.name === 'LimitExceededException'
        console.log(`error deleting ${TableName}: ${err.name}, will retry: ${willRetry}`)
        return willRetry
      },
      initialDelay: 1000,
      maxDelay: 10000,
      maxTime: 5 * 60 * 1000
    })
  }

  console.log('deleted', toDelete)
})
.catch(console.error)
