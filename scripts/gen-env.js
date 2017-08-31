#!/usr/bin/env node

const path = require('path')
const co = require('co')
const promisify = require('pify')
const { exec } = promisify(require('child_process'))
const fs = promisify(require('fs'))
const { prettify } = require('../project/lib/string-utils')
const { getConfiguration } = require('../project/lib/lambda-utils')
const serviceMapPath = path.join(process.cwd(), 'project/conf/service-map.json')
const serverlessYml = require('./serverless-yml')

// when this is merged:
// https://github.com/serverless/serverless/pull/4169
// use it to interpolate variables and read serverlessYml.custom.prefix
co(function* () {
  const { service, custom } = serverlessYml
  const prefix = `${service}-${custom.stage}-`
  const setEnvFnName = `${prefix}setenvvars`
  const { Environment } = yield getConfiguration(setEnvFnName)
  yield fs.writeFile(serviceMapPath, prettify(Environment.Variables))
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
