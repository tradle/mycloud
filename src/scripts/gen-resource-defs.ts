#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import fs from 'fs'
import { resources } from '../cli/resources'
const debug = require('debug')('tradle:gen-resource-defs')

const defFilePath = path.resolve(__dirname, '../../src/definitions.json')
debug('Writing %s', defFilePath)
fs.writeFileSync(defFilePath, JSON.stringify(resources.tables, null, 2))
