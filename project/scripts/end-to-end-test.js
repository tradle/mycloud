#!/usr/bin/env node

require('../test/env')

const co = require('co')
const { genLocalResources } = require('../lib/cli/utils')
const {
  clear,
  endToEndTest
} = require('../test/end-to-end')

co(function* () {
  yield clear()
  yield genLocalResources()
  yield endToEndTest()
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
