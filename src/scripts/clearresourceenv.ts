#!/usr/bin/env node
const co = require('co').wrap
const AWS = require('AWS-SDK')
const { aws, resources } = require('../')
const StackName = process.argv[2]
// const Bucket = 'io.tradle.dev.deploys'
co(clearResourceEnvVars)().catch(console.error)

function* clearResourceEnvVars () {
  const { StackResourceSummaries } = yield aws.cloudformation.listStackResources({
    StackName
  }).promise()

  const lambdas = StackResourceSummaries
    .filter(({ ResourceType }) => ResourceType === 'AWS::Lambda::Function')

  yield Promise.all(lambdas.map(co(function* (summary) {
    return yield clearResourceEnvVarsForFunction(summary)
  })))
}

function* clearResourceEnvVarsForFunction (summary) {
  const { PhysicalResourceId } = summary
  const current = yield aws.lambda.getFunctionConfiguration({
    FunctionName: PhysicalResourceId
  }).promise()

  const { Variables } = current.Environment
  const toDelete = Object.keys(Variables).filter(key => {
    return resources.fromEnvironmentMapping(key, Variables[key])
  })

  if (!toDelete.length) return

  toDelete.forEach(key => {
    delete Variables[key]
  })

  yield aws.lambda.updateFunctionConfiguration({
    FunctionName: PhysicalResourceId,
    Environment: { Variables }
  }).promise()
}
