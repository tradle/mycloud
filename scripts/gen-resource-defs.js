#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const path = require('path')
const fs = require('fs')
const { getTableDefinitions } = require('../lib/cli/utils')
const defFilePath = path.resolve(__dirname, '../lib/definitions.json')
fs.writeFile(defFilePath, JSON.stringify(getTableDefinitions(), null, 2))
