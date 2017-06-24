require('./env')

const test = require('tape')
const Tradle = require('../')
const createBot = require('../lib/bot')
// const messages = require('../lib/messages')
const { co, loudCo, pick } = Tradle.utils
const { toStreamItems, recreateTable } = require('./utils')
// const seals = require('../lib/seals')
const aliceKeys = require('./fixtures/alice/keys')
const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')
const schema = require('../conf/table/users').Properties

test('users', loudCo(function* (t) {
  console.warn('make sure localstack is running')
  yield recreateTable(schema)

  const bot = createBot()
  const { users } = bot
  const user = {
    id: bob.permalink,
    identity: bob.object
  }

  const promiseOnCreate = new Promise(resolve => {
    bot.onusercreate(resolve)
  })

  t.same(yield users.createIfNotExists(user), user, 'create if not exists')
  t.same(yield users.get(user.id), user, 'get by primary key')

  // doesn't overwrite
  yield users.createIfNotExists({
    id: user.id
  })

  t.same(yield promiseOnCreate, user)
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

  const tradle = Tradle.new()
  const { messages, identities } = tradle
  const bot = createBot()
  const { users } = bot
  users.createIfNotExists = co(function* (user) {
    t.equal(user.id, message.author)
    return user
  })

  const { getMessageFrom } = messages
  const { getIdentityByPermalink } = identities
  const message = {
    author: 'bob',
    recipient: 'alice',
    link: 'a',
    time: 123
  }

  const payload = {
    link: 'b'
  }

  messages.getMessageFrom = co(function* ({ author, time }) {
    t.equal(author, message.author)
    t.equal(time, message.time)
    return { message, payload }
  })

  identities.getIdentityByPermalink = co(function* (permalink) {
    t.equal(permalink, message.author)
    return bob.object
  })

  bot.onmessage(co(function* ({ user, wrapper }) {
    t.equal(user.id, message.author)
    t.same(wrapper.message, message)
    t.same(wrapper.payload, payload)
  }))

  // const conversation = yield bot.users.history('bob')
  // console.log(conversation)

  yield bot.exports.onmessage(JSON.stringify(pick(message, ['author', 'time'])))
  messages.getMessageFrom = getMessageFrom
  identities.getIdentityByPermalink = getIdentityByPermalink
}))

test('onreadseal', loudCo(function* (t) {
  const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'

  let read
  let wrote
  const tradle = Tradle.new()
  const { seals, provider } = tradle
  const { getMyKeys } = provider
  provider.getMyKeys = () => Promise.resolve(aliceKeys)

  seals.create = co(function* ({ key, link }) {
    yield bot.exports.onsealevent(toStreamItems([
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

  provider.getMyKeys = getMyKeys
  t.end()
}))

test('use()', loudCo(function* (t) {
  const expectedArg = {}
  const called = {
    onusercreate: false,
    onuseronline: false,
    onreadseal: false,
    onwroteseal: false
  }

  const bot = createBot()
  bot.use(() => {
    Object.keys(called).forEach(method => {
      bot[method](co(function* (arg) {
        t.equal(arg, expectedArg)
        called[method] = true
      }))
    })
  })

  for (let method in called) {
    yield bot.exports[method](expectedArg)
    t.equal(called[method], true)
  }

  t.end()
}))
