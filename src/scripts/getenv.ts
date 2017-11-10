#!/usr/bin/env node
const co = require('co').wrap
const { aws } = require('../')
// const Bucket = 'io.tradle.dev.deploys'
co(getEnv)().catch(console.error)

function* getEnv () {
  const { Environment } = yield aws.lambda.getFunctionConfiguration({
    FunctionName: 'tradle-dev-http_catchall'
  }).promise()

  process.stdout.write(JSON.stringify(Environment.Variables, null, 2))
}
