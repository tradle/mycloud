#!/usr/bin/env node

require('../test/env')
const { genLocalResources } require('../lib/cli/utils')

genLocalResources().catch(err => {
  console.error(err)
  process.exit(1)
})
