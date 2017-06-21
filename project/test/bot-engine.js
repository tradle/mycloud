const test = require('tape')
const createBot = require('../lib/bot-engine')
const Messages = require('../lib/messages')
const { co, loudCo, pick } = require('../lib/utils')
const { toStreamItems } = require('./utils')
// const User = require('../lib/user')
// const Delivery = require('../lib/delivery')
// const alice = require('./fixtures/alice/object')
// const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')

test('onmessage', loudCo(function* (t) {
  t.plan(4)

  const bot = createBot()
  const { getMessageFrom } = Messages
  const message = {
    author: 'bob',
    recipient: 'alice',
    link: 'a',
    time: 123
  }

  const payload = {
    link: 'b'
  }

  Messages.getMessageFrom = co(function* ({ author, time }) {
    t.equal(author, message.author)
    t.equal(time, message.time)
    return { message, payload }
  })

  const processMessage = bot.onmessage(co(function* (event) {
    t.same(event.message, message)
    t.same(event.payload, payload)
  }))

  yield processMessage(JSON.stringify(pick(message, ['author', 'time'])))
  Messages.getMessageFrom = getMessageFrom
}))

test('onreadseal', loudCo(function* (t) {
  const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'
  const bot = createBot()

  let read
  let wrote
  bot.onreadseal(co(function* (event) {
    read = true
    t.equal(event.link, link)
  }))

  bot.onwroteseal(co(function* (event) {
    wrote = true
    t.equal(event.link, link)
  }))

  yield bot._onsealevent(toStreamItems([
    {
      old: {
        link,
        unsealed: 'x'
      },
      new: {
        link
      }
    },
    {
      old: {
        link,
        unconfirmed: 'x'
      },
      new: {
        link
      }
    },
  ]))

  t.equal(read, true)
  t.equal(wrote, true)
  t.end()
}))
