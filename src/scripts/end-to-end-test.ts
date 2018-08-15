#!/usr/bin/env node

require('source-map-support').install()
require('../test/env').install()

import {
  Test
} from '../test/end-to-end'

import { createTestBot } from '../'
import { loadConfAndComponents } from '../in-house-bot'

(async () => {
  let bot = createTestBot()
  const { debug } = bot.logger
  debug('initialized provider')

  debug('setting up bot')

  const product = 'nl.tradle.DigitalPassport'
  const customStuff = await loadConfAndComponents({
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

  debug('running test')
  const test = new Test(customStuff)
  // await test.runEmployeeAndFriend()
  await test.runEmployeeAndCustomer({ product })
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
