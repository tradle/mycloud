#!/usr/bin/env node

const co = require('co')
const {
  clear,
  endToEndTest
} = require('../project/test/end-to-end')

co(function* () {
  yield clear()
  yield endToEndTest()
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
