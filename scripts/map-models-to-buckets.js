#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { loadEnv, loadCredentials, getTableDefinitions } = require('../lib/cli/utils')

loadEnv()
loadCredentials()

const { dbUtils } = require('../').tradle
const { models } = require('../samplebot')
const outputPath = path.join(__dirname, '../lib/modelmap.json')
const output = dbUtils.getModelMap({ models })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
