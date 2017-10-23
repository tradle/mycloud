#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const path = require('path')
const co = require('co')
const promisify = require('pify')
const { exec } = promisify(require('child_process'))
const fs = promisify(require('fs'))
const { prettify } = require('../lib/string-utils')
const { lambdaUtils } = require('../').tradle
const serviceMapPath = path.resolve(__dirname, '../lib/cli/remote-service-map.json')
const { loadCredentials } = require('../lib/cli/utils')
const serverlessYml = require('../lib/cli/serverless-yml')

// when this is merged:
// https://github.com/serverless/serverless/pull/4169
// use it to interpolate variables and read serverlessYml.custom.prefix
co(function* () {
  const { service, custom } = serverlessYml
  const prefix = `${service}-${custom.stage}-`
  const setEnvFnName = `${prefix}onmessage`
  const { Environment } = yield lambdaUtils.getConfiguration(setEnvFnName)
  yield fs.writeFile(serviceMapPath, prettify(Environment.Variables))
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
