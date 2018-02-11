#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path = require('path')
import promisify = require('pify')
import _fs = require('fs')
import { prettify } from '../string-utils'
import { LambdaUtils } from '../lambda-utils'
import { StackUtils } from '../stack-utils'
import { Env } from '../env'
import { createAWSWrapper } from '../aws'
import { Logger } from '../logger'
import { createRemoteTradle } from '../'
import { loadCredentials, loadRemoteEnv, downloadDeploymentTemplate } from '../cli/utils'

const serverlessYml = require('../cli/serverless-yml')
const fs = promisify(_fs)
const serviceMapPath = path.resolve(__dirname, '../cli/remote-service-map.json')
const latestTemplatePath = path.resolve(__dirname, '../cli/cloudformation-template.json')
const { service, custom } = serverlessYml
const prefix = `${service}-${custom.stage}-`

loadCredentials()

const env = new Env(process.env)
const logger = new Logger('gen:testenv')
const aws = createAWSWrapper({ logger, env })
const lambdaUtils = new LambdaUtils({ env, aws })
const getEnv = async () => {
  const setEnvFnName = `${prefix}onmessage`
  const { Environment } = await lambdaUtils.getConfiguration(setEnvFnName)
  await fs.writeFile(serviceMapPath, prettify(Environment.Variables))
}

const getTemplate = async () => {
  const template = await downloadDeploymentTemplate(createRemoteTradle())
  await fs.writeFile(latestTemplatePath, prettify(template))
}

getEnv()
  .then(() => loadRemoteEnv())
  .then(() => getTemplate())
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
