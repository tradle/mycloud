import test from 'tape'
import { tradle } from '../'
import { loudCo } from '../utils'

const alice = require('./fixtures/alice/object')
const bob = require('./fixtures/bob/object')
const fromBob = require('./fixtures/alice/receive.json')

test('onSentMessage', loudCo(function* (t) {
  try {
    yield tradle.user.onSentMessage({
      clientId: `${bob.permalink}blah`,
      message: { blah: 1 }
    })

    t.fail('expected InvalidMessageFormat error')
  } catch (err) {
    t.equal(err.name, 'InvalidMessageFormat')
  }

  t.end()
}))
