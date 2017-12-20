require('./env').install()

const test = require('tape')
const sinon = require('sinon')
const cfnResponse = require('cfn-response')
const IotMessage = require('@tradle/iot-message')
const tradleUtils = require('@tradle/engine').utils
const { createTestTradle } = require('../')
const createRealBot = require('../bot').createBot
const { getGraphqlAPI } = require('../bot/graphql')
const createFakeBot = require('./mock/bot')
const { co, loudCo, clone, pick, wait } = require('../utils')
const { toStreamItems, shallowExend, recreateTable } = require('./utils')
const Errors = require('../errors')
const aliceKeys = require('./fixtures/alice/keys')
const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')
// const apiGatewayEvent = require('./fixtures/events/api-gateway')
const UsersTableLogicalId = 'UsersTable'
const rethrow = err => {
  if (err) throw err
}

;[/*createFakeBot,*/ createRealBot].forEach((createBot, i) => {
  const mode = createBot === createFakeBot ? 'mock' : 'real'
  // test('await ready', loudCo(function* (t) {
  //   const bot = createBot({ tradle: createTestTradle() })
  //   const expectedEvent = toStreamItems([
  //     {
  //       old: {
  //         link: 'a',
  //         unsealed: 'x'
  //       },
  //       new: {
  //         link: 'b'
  //       }
  //     }
  //   ])

  //   let waited
  //   bot.hook('seal', co(function* (event) {
  //     t.equal(waited, true)
  //     t.equal(event, expectedEvent)
  //     t.end()
  //   }))

  //   bot.trigger('seal', expectedEvent).catch(t.error)

  //   yield wait(100)
  //   waited = true
  //   bot.ready()
  // }))

  test(`users (${mode})`, loudCo(function* (t) {
    if (mode === 'real') {
      yield recreateTable(UsersTableLogicalId)
    }

    const bot = createBot({ tradle: createTestTradle() })
    const { users } = bot
    // const user : Object = {
    const user = {
      id: bob.permalink,
      identity: bob.object
    }

    const promiseOnCreate = new Promise(resolve => {
      bot.hook('usercreate', resolve)
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

  test('init', loudCo(function* (t) {
    const tradle = createTestTradle()
    const bot = createBot({ tradle })
    const originalEvent = {
      RequestType: 'Create',
      ResponseURL: 'some-s3-url',
      ResourceProperties: {
        some: 'prop'
      }
    }

    const expectedEvent = {
      type: 'init',
      payload: {
        some: 'prop'
      }
    }

    const originalContext = {}
    sinon.stub(tradle.init, 'init').callsFake(async (opts) => {
      t.same(opts, expectedEvent.payload)
    })

    let { callCount } = cfnResponse.send

    bot.oninit(co(function* (event) {
      t.same(event, expectedEvent)
    }))

    yield bot.lambdas.oninit().handler(originalEvent, {
      done: t.error
    })

    t.equal(cfnResponse.send.getCall(callCount++).args[2], cfnResponse.SUCCESS)

    bot.oninit(co(function* (event) {
      throw new Error('test error')
    }))

    yield bot.lambdas.oninit().handler(originalEvent, {
      done: (err) => t.equal(err.message, 'test error')
    })

    t.equal(cfnResponse.send.getCall(callCount++).args[2], cfnResponse.FAILED)
    t.end()
  }))

  test(`onmessage (${mode})`, loudCo(function* (t) {
    t.plan(6)

    const tradle = createTestTradle()
    const { objects, messages, identities } = tradle
    const bot = createBot({ tradle })
    const { users } = bot

    let updatedUser
    users.merge = co(function* () {
      updatedUser = true
    })

    users.createIfNotExists = co(function* (user) {
      // #1
      t.equal(user.id, message._author)
      return user
    })

    // const { byPermalink } = identities
    const payload = {
      _link: 'b',
      _permalink: 'b',
      _t: 'a',
      _s: 'sig',
      _author: 'carol',
      _virtual: ['_author', '_link', '_permalink']
    }

    const message = {
      time: 123,
      _author: 'bob',
      _recipient: 'alice',
      _link: 'a',
      object: payload,
      _virtual: ['_author', '_recipient', '_link']
    }

    sinon.stub(objects, 'get').callsFake(co(function* (link) {
      if (link === message._link) {
        return message.object
      } else if (link === payload._link) {
        return payload
      }

      throw new Errors.NotFound(link)
    }))

    sinon.stub(tradle.user, 'onSentMessage').callsFake(async () => {
      return message
    })

    // identities.byPermalink = co(function* (permalink) {
    //   t.equal(permalink, message.author)
    //   return bob.object
    // })

    bot.hook('message', co(function* (data) {
      const { user } = data
      user.bill = 'ted'
      // 2, 3, 4
      t.equal(user.id, message._author)
      t.same(data.message, message)
      t.same(data.payload, payload)
    }))

    // const conversation = yield bot.users.history('bob')
    // console.log(conversation)

    // #5
    const data = yield IotMessage.encode({
      payload: message
    })

    yield bot.lambdas.onmessage().handler({
      // clientId: 'ted',
      data
    }, {
      done: t.error
    })

    // yield bot.trigger('message', message)
    // #6
    t.equal(updatedUser, true)
    // identities.byPermalink = byPermalink
  }))

  test(`readseal (${mode})`, loudCo(function* (t) {
    const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'

    let read
    let wrote
    const tradle = createTestTradle()
    const { seals, provider } = tradle
    const { getMyKeys } = provider
    provider.getMyKeys = () => Promise.resolve(aliceKeys)

    const bot = createBot({ tradle })
    bot.hook('readseal', co(function* (event) {
      read = true
      t.equal(event.link, link)
    }))

    bot.hook('wroteseal', co(function* (event) {
      wrote = true
      t.equal(event.link, link)
    }))

    yield bot.lambdas.onsealstream().handler(toStreamItems([
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
    ]), {
      done: t.error
    })

    t.equal(read, true)
    t.equal(wrote, true)

    provider.getMyKeys = getMyKeys
    t.end()
  }))

  test(`use() (${mode})`, loudCo(function* (t) {
    const expectedArg = {}
    const called = {
      usercreate: false,
      useronline: false,
      readseal: false,
      wroteseal: false
    }

    const bot = createBot({ tradle: createTestTradle() })
    bot.use(() => {
      Object.keys(called).forEach(event => {
        bot.hook(event, co(function* (arg) {
          t.equal(arg, expectedArg)
          called[event] = true
        }))
      })
    })

    for (let event in called) {
      yield bot.trigger(event, expectedArg)
      t.equal(called[event], true)
    }

    t.end()
  }))
})

test('onmessagestream', loudCo(function* (t) {
  const message = {
    "_author": "cf9bfbd126553ce71975c00201c73a249eae05ad9030632f278b38791d74a283",
    "_inbound": true,
    "_link": "1843969525f8ecb105ba484b59bb70d3a5d0c38e465f29740fc335e95b766a09",
    "_n": 1,
    "_permalink": "1843969525f8ecb105ba484b59bb70d3a5d0c38e465f29740fc335e95b766a09",
    "_q": "f58247298ef1e815a39394b5a3e724b01b8e0e3217b89699729b8b0698078d89",
    "_recipient": "9fb7144218332ef152b34d6e38d6479ecb07f2c0b649af1cfe0559f870d137c4",
    "_s": "CkkKBHAyNTYSQQSra+ZW0NbpXhWzsrPJ3jaSmzL4LelVpqFr5ZC+VElHxcOD+8zlS+PuhtQrHB6LJ7KF+d8XtQzgYhVX1FXEBYYREkcwRQIgcF+hp6e5KnVj9VapsvnVkaJ6d3DL84DmJ3UueEHGiQMCIQDr0w0RJXIrLk7O1AgeEeLQfloFslsDzWVcHs4AhOFcrg==",
    "_sigPubKey": "04ab6be656d0d6e95e15b3b2b3c9de36929b32f82de955a6a16be590be544947c5c383fbcce54be3ee86d42b1c1e8b27b285f9df17b50ce0621557d455c4058611",
    "_t": "tradle.Message",
    "_payloadType": "tradle.Ping",
    "_virtual": [
      "_sigPubKey",
      "_link",
      "_permalink",
      "_author",
      "_recipient"
    ],
    "object": {
      "_author": "cf9bfbd126553ce71975c00201c73a249eae05ad9030632f278b38791d74a283",
      "_link": "e886aba619b76982a6eb3ed6e70065d324eddcd9fe1968bf33ea0e59662925c4",
      "_permalink": "e886aba619b76982a6eb3ed6e70065d324eddcd9fe1968bf33ea0e59662925c4",
      "_sigPubKey": "04ab6be656d0d6e95e15b3b2b3c9de36929b32f82de955a6a16be590be544947c5c383fbcce54be3ee86d42b1c1e8b27b285f9df17b50ce0621557d455c4058611",
      "_virtual": [
        "_sigPubKey",
        "_link",
        "_permalink",
        "_author"
      ]
    },
    "recipientPubKey": "p256:04fffcaea5138d242b161f44d7310a20eefbbb2c39d8bed1061ec5df62c568d99eab7a6137cc4829ac4e2159f759dedf38ba34b6f4e42a0d9eb9486226402ed6ec",
    "time": 1500317965602
  }

  const payload = {
    _t: 'tradle.Ping',
    _s: 'abc',
    _time: Date.now()
  }

  const tradle = createTestTradle()
  const bot = createRealBot({
    models: require('../bot/ping-pong-models'),
    tradle
  })

  const table = bot.db.tables['tradle.Ping']
  // #1
  t.ok(table, 'table created per model')

  const { users } = bot

  const stubGet = sinon.stub(bot.objects, 'get').callsFake(async (link) => {
    // #2
    t.equal(link, message.object._link)
    return payload
  })

  const stubPreSign = sinon.stub(bot.objects, 'presignEmbeddedMediaLinks')
    .callsFake(object => object)

  users.createIfNotExists = co(function* (user) {
    // #3
    t.equal(user.id, message._author)
    return user
  })

  bot.hook('message', co(function* (data) {
    // #4, 5
    const { user } = data
    user.bill = 'ted'
    t.equal(user.id, message._author)
    t.same(data.message, {
      ...message, object: {
        ...message.object,
        ...payload
      }
    })
  }))

  let updatedUser
  users.merge = co(function* () {
    updatedUser = true
  })

  yield bot.lambdas.onmessagestream().handler(toStreamItems([
    { new: message }
  ]), {
    // #6
    done: t.error
  })

  const gql = getGraphqlAPI({ bot })
  const result = yield gql.executeQuery(`
    {
      rl_tradle_Ping(orderBy:{
        property: _time
      }) {
        edges {
          node {
            _link
          }
        }
      }
    }
  `)

  // #7
  t.same(result, {
    "data": {
      "rl_tradle_Ping": {
        "edges": [
          {
            "node": {
              "_link": message.object._link
            }
          }
        ]
      }
    }
  })

  // const introspection = yield bot.trigger('graphql', require('./introspection-query'))
  // console.log('introspection length', JSON.stringify(introspection).length)

  stubGet.restore()
  stubPreSign.restore()

  t.end()
}))

test('validate send', loudCo(function* (t) {
  const tradle = createTestTradle()
  tradle.provider.sendMessage = () => Promise.resolve()
  tradle.provider.sendMessageBatch = () => Promise.resolve()

  const models = {
    'ding.bling': {
      id: 'ding.bling',
      title: 'Ding Bling',
      type: 'tradle.Model',
      properties: {
        ding: {
          type: 'string'
        },
        blink: {
          type: 'number'
        }
      },
      required: ['ding']
    }
  }

  const bot = createRealBot({ tradle, models })
  try {
    yield bot.send({
      to: bob.permalink,
      object: {}
    })

    t.fail('expected payload validation to fail')
  } catch (err) {
    t.ok(/expected/i.test(err.message))
  }

  // undeclared types are ok
  yield bot.send({
    to: bob.permalink,
    object: {
      _t: 'sometype'
    }
  })

  // declared types are validated
  try {
    yield bot.send({
      to: bob.permalink,
      object: {
        _t: 'ding.bling',
      }
    })

    t.fail('validation should have failed')
  } catch (err) {
    t.ok(/required/.test(err.message))
  }

  yield bot.send({
    to: bob.permalink,
    object: {
      _t: 'ding.bling',
      ding: 'dong'
    }
  })

  t.end()
}))
