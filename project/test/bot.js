require('./env')

const test = require('tape')
const createBot = require('../lib/bot')
const Messages = require('../lib/messages')
const { co, loudCo, pick } = require('../lib/utils')
const { toStreamItems } = require('./utils')
// const seals = require('../lib/seals')
const createTradle = require('../').new
const Provider = require('../lib/provider')
const Identities = require('../lib/identities')
// const User = require('../lib/user')
// const Delivery = require('../lib/delivery')
const aliceKeys = require('./fixtures/alice/keys')
const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')
const { recreateTable } = require('./utils')
const schema = require('../conf/table/users').Properties

test('users', loudCo(function* (t) {
  console.warn('make sure localstack is running')
  yield recreateTable(schema)

  const { users } = createBot()
  const user = {
    id: bob.permalink,
    identity: bob.object
  }

  t.same(yield users.createIfNotExists(user), user, 'create if not exists')
  t.same(yield users.get(user.id), user, 'get by primary key')

  // doesn't overwrite
  yield users.createIfNotExists({
    id: user.id
  })

  t.same(yield users.get(user.id), user, '2nd create does not clobber')
  t.same(yield users.list(), [user], 'list')

  user.name = 'bob'
  t.same(yield users.merge(user), user, 'merge')
  t.same(yield users.get(user.id), user, 'get after merge')
  t.same(yield users.del(user.id), user, 'delete')
  t.same(yield users.list(), [], 'list')
  t.end()
}))

test('onmessage', loudCo(function* (t) {
  t.plan(7)

  const bot = createBot()
  const { users } = bot
  users.createIfNotExists = co(function* (user) {
    t.equal(user.id, message.author)
    return user
  })

  const { getMessageFrom } = Messages
  const { getIdentityByPermalink } = Identities
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

  Identities.getIdentityByPermalink = co(function* (permalink) {
    t.equal(permalink, message.author)
    return bob.object
  })

  const processMessage = bot.onmessage(co(function* ({ user, wrapper }) {
    t.equal(user.id, message.author)
    t.same(wrapper.message, message)
    t.same(wrapper.payload, payload)
  }))

  yield processMessage(JSON.stringify(pick(message, ['author', 'time'])))
  Messages.getMessageFrom = getMessageFrom
  Identities.getIdentityByPermalink = getIdentityByPermalink
}))

test('onreadseal', loudCo(function* (t) {
  const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'

  let read
  let wrote
  const tradle = createTradle()
  const { seals } = tradle
  const { getMyKeys } = Provider
  Provider.getMyKeys = () => Promise.resolve(aliceKeys)

  seals.create = co(function* ({ key, link }) {
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
      }
    ]))
  })

  const bot = createBot(tradle)
  bot.onreadseal(co(function* (event) {
    read = true
    t.equal(event.link, link)
  }))

  bot.onwroteseal(co(function* (event) {
    wrote = true
    t.equal(event.link, link)
  }))

  yield bot.seal({ link })

  t.equal(read, true)
  t.equal(wrote, true)

  Provider.getMyKeys = getMyKeys
  t.end()
}))
