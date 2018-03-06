#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { loadRemoteEnv, loadCredentials, getTableDefinitions } from '../cli/utils'

loadCredentials()
loadRemoteEnv()

import { createRemoteTradle } from '../'
import lambda from '../in-house-bot/lambda/mqtt/onmessage'
lambda.bot.promiseReady().then(() => {
  const { dbUtils } = lambda.tradle
  const outputPath = path.join(__dirname, '../modelmap.json')
  const output = dbUtils.getModelMap({ models: lambda.bot.models })
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
})
.catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
