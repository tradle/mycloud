#!/usr/bin/env node

import { createTestTradle } from '../'
import { genLocalResources } from '../cli/utils'
import {
  clear,
  Test
} from '../test/end-to-end'

import { promiseBot } from '../samplebot/lambda/onmessage'

(async () => {
  const tradle = createTestTradle()
  const opts = await promiseBot
  await clear(opts)
  await new Promise(resolve => setTimeout(resolve, 3000))
  await genLocalResources({ tradle })
  const test = new Test(opts)
  // await test.runEmployeeAndFriend()
  await test.runEmployeeAndCustomer()
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
