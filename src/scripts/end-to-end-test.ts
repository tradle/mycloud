#!/usr/bin/env node

require('../test/env').install()

import { genLocalResources } from '../cli/utils'
import {
  clear,
  Test
} from '../test/end-to-end'

(async () => {
  await clear()
  await genLocalResources()
  const test = new Test()
  // await test.runEmployeeAndFriend()
  await test.runEmployeeAndCustomer()
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
