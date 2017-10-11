#!/usr/bin/env node

console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`)

require('../test/env').install()
const { genLocalResources } = require('../lib/cli/utils')

genLocalResources().catch(err => {
  console.error(err)
  process.exit(1)
})
