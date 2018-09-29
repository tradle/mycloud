#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import fs from 'fs'
import { loadRemoteEnv, loadCredentials } from '../cli/utils'

loadCredentials()
loadRemoteEnv()

import lambda from '../in-house-bot/lambda/http/graphql'
lambda.use(async (ctx, next) => {
  const { bot } = ctx.components
  const { models, dbUtils } = bot
  const outputPath = path.join(__dirname, '../modelmap.json')
  const output = dbUtils.getModelMap({ models })
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
})

const invokeLambda = async () => {
  throw new Error('fix me: add http request to trigger lambda')
}

invokeLambda().catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})

