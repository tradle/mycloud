#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const path = require('path')
const co = require('co')
const promisify = require('pify')
const { exec } = promisify(require('child_process'))
const fs = promisify(require('fs'))
const { prettify } = require('../string-utils')
const { aws, lambdaUtils } = require('../').tradle
const serviceMapPath = path.resolve(__dirname, '../cli/remote-service-map.json')
const latestTemplatePath = path.resolve(__dirname, '../cli/cloudformation-template.json')
const { loadCredentials, downloadDeploymentTemplate } = require('../cli/utils')
const serverlessYml = require('../cli/serverless-yml')
const { service, custom } = serverlessYml
const prefix = `${service}-${custom.stage}-`
const getEnv = co.wrap(function* () {
  const setEnvFnName = `${prefix}onmessage`
  const { Environment } = yield lambdaUtils.getConfiguration(setEnvFnName)
  yield fs.writeFile(serviceMapPath, prettify(Environment.Variables))
})

const getTemplate = co.wrap(function* () {
  const template = yield downloadDeploymentTemplate()
  yield fs.writeFile(latestTemplatePath, prettify(template))
})

Promise.all([
  getEnv(),
  getTemplate()
])
.catch(err => {
  console.error(err)
  process.exit(1)
})
