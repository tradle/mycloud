const test = require('tape')
const { loudCo } = require('../lib/utils')
const User = require('../lib/user')
const Delivery = require('../lib/delivery')
const alice = require('./fixtures/alice/object')
const bob = require('./fixtures/bob/object')
const fromBob = require('./fixtures/alice/receive.json')

test('onSentMessage', loudCo(function* (t) {
  try {
    yield User.onSentMessage({
      clientId: `${bob.permalink}blah`,
      message: { blah: 1 }
    })

    t.fail('expected InvalidMessageFormat error')
  } catch (err) {
    t.equal(err.name, 'InvalidMessageFormat')
  }

  t.end()
}))
