#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import fs from 'fs'
import { getTableDefinitions } from '../cli/utils'

const defFilePath = path.resolve(__dirname, '../definitions.json')
fs.writeFile(defFilePath, JSON.stringify(getTableDefinitions(), null, 2), err => {
  if (err) throw err
})
