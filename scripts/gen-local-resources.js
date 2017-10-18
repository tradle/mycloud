#!/usr/bin/env node

process.env.IS_LOCAL = true
process.env.DEBUG = process.env.DEBUG || 'tradle*'

console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`)

const co = require('co')

require('../test/env').install()
const { init } = require('../').tradle
const { genLocalResources } = require('../lib/cli/utils')

co(function* () {
  yield genLocalResources()
  yield init.init({ force: true })
})
.catch(err => {
  console.error(err)
  process.exitCode = 1
})
