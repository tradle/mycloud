#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import promisify from 'pify'
import _fs from 'fs'
import { prettify } from '../string-utils'
import { LambdaUtils } from '../lambda-utils'
import { Env } from '../env'
import { createAWSWrapper } from '../aws'
import { Logger } from '../logger'
import { createRemoteBot } from '../'
import { loadCredentials, downloadDeploymentTemplate } from '../cli/utils'

const serverlessYml = require('../cli/serverless-yml')
const fs = promisify(_fs)
const serviceMapPath = path.resolve(__dirname, '../../src/cli/remote-service-map.json')
const latestTemplatePath = path.resolve(__dirname, '../../src/cli/cloudformation-template.json')
const { service, custom } = serverlessYml
const prefix = `${service}-${custom.stage}-`

loadCredentials()
process.env.AWS_REGION = serverlessYml.provider.region

const env = new Env(process.env)
const logger = new Logger('gen:testenv')
const aws = createAWSWrapper({ logger, env })
const lambdaUtils = new LambdaUtils({ env, aws, logger })
const getEnv = async () => {
  const setEnvFnName = `${prefix}onmessage`
  const { Environment } = await lambdaUtils.getConfiguration(setEnvFnName)
  const vars = Environment.Variables
  vars.AWS_REGION = serverlessYml.provider.region
  await Promise.all([
    fs.writeFile(serviceMapPath, prettify(vars)),
    fs.writeFile(serviceMapPath.replace(/\/src\//, '/lib/'), prettify(vars))
  ])
}

const getTemplate = async () => {
  const template = await downloadDeploymentTemplate(createRemoteBot())
  await fs.writeFile(latestTemplatePath, prettify(template))
}

getEnv()
  .then(() => getTemplate())
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
