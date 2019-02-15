#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = "false"

import path from "path"
import promisify from "pify"
import _fs from "fs"
import { LambdaClient } from "@tradle/aws-lambda-client"
import { createClientCache } from "@tradle/aws-client-factory"
import { prettify } from "../string-utils"
import { Env } from "../env"
// import { createAWSWrapper } from "../aws"
import { Logger } from "../logger"
import { createRemoteBot, createTestBot } from "../"
import { loadCredentials, downloadDeploymentTemplate } from "../cli/utils"
import { PRIVATE_CONF_BUCKET } from "../in-house-bot/constants"
import { Bot } from "../types"
import Errors from "../errors"

const serverlessYml = require("../cli/serverless-yml")
const fs = promisify(_fs)
const serviceMapPath = path.resolve(__dirname, "../../src/cli/remote-service-map.json")
const latestTemplatePath = path.resolve(__dirname, "../../src/cli/cloudformation-template.json")
const { service, custom } = serverlessYml
const prefix = `${service}-${custom.stage}-`

loadCredentials()
process.env.AWS_REGION = serverlessYml.provider.region

const env = new Env(process.env)
const logger = new Logger("gen:testenv")
const aws = createClientCache()
const lambdaUtils = new LambdaClient({ client: aws.lambda })
const getEnv = async () => {
  const setEnvFnName = `${prefix}onmessage`
  const { Environment } = await lambdaUtils.getConfiguration(setEnvFnName)
  const vars = Environment.Variables
  vars.AWS_REGION = serverlessYml.provider.region
  await Promise.all([
    fs.writeFile(serviceMapPath, prettify(vars)),
    fs.writeFile(serviceMapPath.replace(/\/src\//, "/lib/"), prettify(vars))
  ])
}

const getTemplate = async (bot: Bot) => {
  const template = await downloadDeploymentTemplate(bot)
  await fs.writeFile(latestTemplatePath, prettify(template))
}

const getECSDiscovery = async (bot: Bot) => {
  let discovery
  try {
    discovery = await bot.buckets.PrivateConf.getJSON(PRIVATE_CONF_BUCKET.kycServiceDiscovery)
  } catch (err) {
    Errors.ignoreNotFound(err)
    return
  }

  const testBot = createTestBot()
  const bucket = testBot.buckets.PrivateConf
  try {
    await bucket.putJSON(PRIVATE_CONF_BUCKET.kycServiceDiscovery, discovery)
  } catch (err) {
    if (Errors.matches(err, { code: "NoSuchBucket" })) {
      logger.error(`local bucket ${bucket.id} does not exist!`)
      return
    }

    logger.error("failed to save ECS discovery info to local test bucket", {
      bucket: bucket.id,
      error: err.stack
    })

    throw err
  }
}

getEnv()
  .then(async () => {
    const bot = createRemoteBot()
    await getTemplate(bot)
    await getECSDiscovery(bot)
  })
  .catch(err => {
    // tslint:disable-next-line
    console.error(err)
    process.exit(1)
  })
