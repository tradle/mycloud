#!/usr/bin/env node

require('source-map-support').install()
require('../test/env').install()

import { wait } from '../utils'
import { genLocalResources, initializeProvider } from '../cli/utils'
import {
  clear,
  Test
} from '../test/end-to-end'

import { createTestTradle } from '../'
import { createBot } from '../bot'
import { customize } from '../samplebot/customize'

(async () => {
  let tradle = createTestTradle()
  const { debug } = tradle.logger
  // await clear({ tradle })
  // debug('cleared stored data')
  // await wait(2000)
  // await genLocalResources({ tradle })
  // await wait(2000)

  tradle = createTestTradle()
  // await initializeProvider({ bot: createBot({ tradle }) })
  debug('initialized provider')

  tradle.logger.debug('setting up bot')

  const bot = createBot()
  const customStuff = await customize({
    bot,
    conf: {}
  })

  tradle.logger.debug('running test')
  const test = new Test(customStuff)
  // await test.runEmployeeAndFriend()
  await test.runEmployeeAndCustomer()
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
