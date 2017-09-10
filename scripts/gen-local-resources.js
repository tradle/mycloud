#!/usr/bin/env node

require('../project/test/env')

const co = require('co')
const extend = require('xtend/mutable')
const { aws, resources } = require('../project')
const { ensureInitialized } = require('../project/lib/init')

const setup = co.wrap(function* () {
  const stack = require('../.serverless/cloudformation-template-update-stack')
  const { Resources } = stack
  const tables = []
  const buckets = []
  Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')
    .forEach(name => {
      const { Type, Properties } = Resources[name]
      if (Properties.StreamSpecification) {
        Properties.StreamSpecification.StreamEnabled = true
      }

      tables.push(aws.dynamodb
        .createTable(Properties)
        .promise()
        .catch(err => {
          if (err.name !== 'ResourceInUseException') {
            throw err
          }
        }))
    })

  Object.keys(resources.Bucket).forEach(name => {
    const Bucket = resources.Bucket[name]
    buckets.push(aws.s3
      .createBucket({ Bucket })
      .promise())
  })

  yield buckets
  yield tables
  yield ensureInitialized()
})

co(function* () {
  yield setup()
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
