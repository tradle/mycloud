import test from 'tape'
import { bot } from '../'
import { loudAsync } from '../utils'

const alice = require('./fixtures/alice/object')
const bob = require('./fixtures/bob/object')
const fromBob = require('./fixtures/alice/receive.json')

test(
  'onSentMessage',
  loudAsync(async t => {
    try {
      await bot.userSim.onSentMessage({
        clientId: `${bob.permalink}blah`,
        message: { blah: 1 }
      })

      t.fail('expected InvalidMessageFormat error')
    } catch (err) {
      t.equal(err.name, 'InvalidMessageFormat')
    }

    t.end()
  })
)
