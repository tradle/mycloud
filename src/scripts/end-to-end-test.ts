#!/usr/bin/env node

require('source-map-support').install()
require('../test/env').install()

import {
  clear,
  Test
} from '../test/end-to-end'

import { createTestTradle } from '../'
import { createBot } from '../bot'
import { customize } from '../in-house-bot/customize'

(async () => {
  let tradle = createTestTradle()
  const { debug } = tradle.logger
  tradle = createTestTradle()
  debug('initialized provider')

  tradle.logger.debug('setting up bot')

  const product = 'nl.tradle.DigitalPassport'
  const bot = createBot()
  const customStuff = await customize({
    bot,
    // conf: {
    //   bot: {
    //     products: {
    //       approveAllEmployees: true,
    //       enabled: [
    //         product
    //       ]
    //     }
    //   }
    // }
  })

  tradle.logger.debug('running test')
  const test = new Test(customStuff)
  // await test.runEmployeeAndFriend()
  await test.runEmployeeAndCustomer({ product })
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
