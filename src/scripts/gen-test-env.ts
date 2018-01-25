#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path = require('path')
import promisify = require('pify')
import _fs = require('fs')
import { prettify } from '../string-utils'
import { loadCredentials, loadRemoteEnv, downloadDeploymentTemplate } from '../cli/utils'

const serverlessYml = require('../cli/serverless-yml')
const fs = promisify(_fs)
const serviceMapPath = path.resolve(__dirname, '../cli/remote-service-map.json')
const latestTemplatePath = path.resolve(__dirname, '../cli/cloudformation-template.json')
const { service, custom } = serverlessYml
const prefix = `${service}-${custom.stage}-`

loadCredentials()
loadRemoteEnv()

const tradle = require('../').createRemoteTradle()
const { lambdaUtils } = tradle

const getEnv = async () => {
  const setEnvFnName = `${prefix}onmessage`
  const { Environment } = await lambdaUtils.getConfiguration(setEnvFnName)
  await fs.writeFile(serviceMapPath, prettify(Environment.Variables))
}

const getTemplate = async () => {
  const template = await downloadDeploymentTemplate(tradle)
  await fs.writeFile(latestTemplatePath, prettify(template))
}

Promise.all([
  getEnv(),
  getTemplate()
])
.catch(err => {
  console.error(err)
  process.exit(1)
})
