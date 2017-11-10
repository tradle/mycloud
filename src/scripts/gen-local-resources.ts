#!/usr/bin/env node

process.env.IS_LOCAL = true
process.env.DEBUG = process.env.DEBUG || 'tradle*'

console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`)

const { force } = require('minimist')(process.argv.slice(2), {
  boolean: ['force']
})

const co = require('co')

require('../test/env').install()
const { init } = require('../').tradle
const { genLocalResources } = require('../cli/utils')
const { brand } = require('../cli/serverless-yml').custom
const opts = {
  force,
  name: brand.env.ORG_NAME + '-local',
  domain: brand.env.ORG_DOMAIN + '.local',
  logo: brand.env.ORG_LOGO
}

co(function* () {
  yield genLocalResources()
  if (force) {
    yield init.init(opts)
  } else {
    yield init.ensureInitialized(opts)
  }
})
.catch(err => {
  console.error(err)
  process.exitCode = 1
})
