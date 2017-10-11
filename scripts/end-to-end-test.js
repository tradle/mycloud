#!/usr/bin/env node

require('../test/env').install()

const co = require('co')
const { genLocalResources } = require('../lib/cli/utils')
const {
  clear,
  Test
} = require('../test/end-to-end')

co(function* () {
  yield clear()
  yield genLocalResources()
  const test = new Test()
  // yield test.runEmployeeAndFriend()
  yield test.runEmployeeAndCustomer()
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
