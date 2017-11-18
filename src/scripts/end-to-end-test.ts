#!/usr/bin/env node

// require('../test/env').install()

import { createTestTradle } from '../'
import { genLocalResources } from '../cli/utils'
import {
  clear,
  Test
} from '../test/end-to-end'

(async () => {
  const tradle = createTestTradle()
  await clear()
  await genLocalResources({ tradle })
  const test = new Test()
  // await test.runEmployeeAndFriend()
  await test.runEmployeeAndCustomer()
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
