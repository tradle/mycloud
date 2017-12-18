#!/usr/bin/env node

process.env.IS_LOCAL = 'true'
process.env.DEBUG = process.env.DEBUG || 'tradle*'

require('source-map-support').install()

console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`)

const { force } = require('minimist')(process.argv.slice(2), {
  boolean: ['force']
})

import promisify = require('pify')
import { tradle } from '../'
import { genLocalResources, initializeProvider } from '../cli/utils'
import Errors = require('../errors')

const rethrow = (err) => {
  if (err) throw err
}

initializeProvider().catch(err => {
  console.error(err)
  process.exitCode = 1
})
