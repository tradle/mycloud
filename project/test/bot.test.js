require('./env')

const test = require('tape')
const Tradle = require('../')
const { clone } = require('../lib/utils')
const createRealBot = require('../lib/bot')
const createFakeBot = require('./mock/bot')
// const messages = require('../lib/messages')
const { co, loudCo, pick } = Tradle.utils
const { toStreamItems, recreateTable } = require('./utils')
const Errors = require('../lib/errors')
// const seals = require('../lib/seals')
const aliceKeys = require('./fixtures/alice/keys')
const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')
const schema = clone(
  require('../conf/table/users').Properties,
  {
    TableName: process.env.CF_UsersTable
  }
)

;[createFakeBot, createRealBot].forEach((createBot, i) => {
  const mode = createBot === createFakeBot ? 'mock' : 'real'
  test(`users (${mode})`, loudCo(function* (t) {
    console.warn('make sure localstack is running')
    if (mode === 'real') {
      yield recreateTable(schema)
    }

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

  test(`onmessage (${mode})`, loudCo(function* (t) {
    t.plan(6)

    const tradle = Tradle.new()
    const { objects, messages, identities } = tradle
    const bot = createBot({ tradle })
    const { users } = bot

    let updatedUser
    users.merge = co(function* () {
      updatedUser = true
    })

    users.createIfNotExists = co(function* (user) {
      t.equal(user.id, message.author)
      return user
    })

    const { getIdentityByPermalink } = identities
    const { getObjectByLink } = objects
    const payload = {
      link: 'b',
      object: {
        _t: 'a'
      }
    }

    const message = {
      author: 'bob',
      recipient: 'alice',
      link: 'a',
      time: 123,
      object: {
        object: payload.object
      }
    }

    objects.getObjectByLink = co(function* (link) {
      if (link === message.link) {
        return message.object
      } else if (link === payload.link) {
        return payload.object
      }

      throw new Errors.NotFound(link)
    })

    identities.getIdentityByPermalink = co(function* (permalink) {
      t.equal(permalink, message.author)
      return bob.object
    })

    bot.onmessage(co(function* ({ user, wrapper }) {
      user.bill = 'ted'
      t.equal(user.id, message.author)
      t.same(wrapper.message, message)
      t.same(wrapper.payload, payload)
    }))

    // const conversation = yield bot.users.history('bob')
    // console.log(conversation)

    yield bot.exports.onmessage(JSON.stringify({ message, payload }))
    t.equal(updatedUser, true)
    objects.getObjectByLink = getObjectByLink
    identities.getIdentityByPermalink = getIdentityByPermalink
  }))

  test(`onreadseal (${mode})`, loudCo(function* (t) {
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

    const bot = createBot({ tradle })
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

  test(`use() (${mode})`, loudCo(function* (t) {
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
})
