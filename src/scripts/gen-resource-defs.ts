#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import fs from 'fs'
import { resources } from '../cli/resources'

const defFilePath = path.resolve(__dirname, '../../src/definitions.json')
fs.writeFile(defFilePath, JSON.stringify(resources.tables, null, 2), err => {
  if (err) throw err
})
