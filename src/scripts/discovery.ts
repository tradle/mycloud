#!/usr/bin/env node
// require('../env')

const { getStackName } = require('../cli/utils')
const stackName = getStackName()
process.env.AWS_LAMBDA_FUNCTION_NAME = `${stackName}-setenvvars`
process.env.SERVERLESS_PREFIX = `${stackName}-`

const co = require('co')
const { discovery } = require('../')
// const Bucket = 'io.tradle.dev.deploys'
co(discover)
  .then(env => {
    process.stdout.write(JSON.stringify(env, null, 2))
  })
  .catch(console.error)

function* discover () {
  // console.log(yield s3.getBucketAcl({ Bucket }).promise())
  return yield discovery.discoverServices(stackName)
}
