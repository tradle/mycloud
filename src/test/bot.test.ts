require('./env').install()

import crypto = require('crypto')
import _ = require('lodash')
import test = require('tape')
import sinon = require('sinon')
import cfnResponse = require('cfn-response')
import { TYPE, SEQ, SIG } from '@tradle/constants'
import IotMessage = require('@tradle/iot-message')
import { utils as tradleUtils } from '@tradle/engine'
import { createTestTradle } from '../'
import { createBot as createRealBot } from '../bot'
import { getGraphqlAPI } from '../bot/graphql'
import createFakeBot = require('./mock/bot')
import { loudAsync, wait } from '../utils'
import { toStreamItems, recreateTable } from './utils'
import Errors = require('../errors')
import PingPongModels = require('../bot/ping-pong-models')
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
  // test('await ready', loudAsync(async (t) => {
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
  //   bot.hook('seal', async (event) => {
  //     t.equal(waited, true)
  //     t.equal(event, expectedEvent)
  //     t.end()
  //   })

  //   bot.trigger('seal', expectedEvent).catch(t.error)

  //   await wait(100)
  //   waited = true
  //   bot.ready()
  // }))

  test(`users (${mode})`, loudAsync(async (t) => {
    if (mode === 'real') {
      await recreateTable(UsersTableLogicalId)
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

    t.same(await users.createIfNotExists(user), user, 'create if not exists')
    t.same(await users.get(user.id), user, 'get by primary key')

    // doesn't overwrite
    await users.createIfNotExists({
      id: user.id
    })

    t.same(await promiseOnCreate, user)
    t.same(await users.get(user.id), user, '2nd create does not clobber')
    t.same(await users.list(), [user], 'list')

    user.name = 'bob'
    t.same(await users.merge(user), user, 'merge')
    t.same(await users.get(user.id), user, 'get after merge')
    t.same(await users.del(user.id), user, 'delete')
    t.same(await users.list(), [], 'list')
    t.end()
  }))

  test('init', loudAsync(async (t) => {
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

    bot.oninit(async (event) => {
      t.same(event, expectedEvent)
    })

    await bot.lambdas.oninit().handler(originalEvent, {
      done: t.error
    })

    t.equal(cfnResponse.send.getCall(callCount++).args[2], cfnResponse.SUCCESS)

    bot.oninit(async (event) => {
      throw new Error('test error')
    })

    await bot.lambdas.oninit().handler(originalEvent, {
      done: (err) => t.equal(err.message, 'test error')
    })

    t.equal(cfnResponse.send.getCall(callCount++).args[2], cfnResponse.FAILED)
    t.end()
  }))

  test(`onmessage (${mode})`, loudAsync(async (t) => {
    t.plan(6)

    const tradle = createTestTradle()
    const { objects, messages, identities } = tradle
    const bot = createBot({ tradle })
    const { users } = bot

    let updatedUser
    users.merge = async () => {
      updatedUser = true
    }

    users.createIfNotExists = async (user) => {
      // #1
      t.equal(user.id, message._author)
      return user
    }

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
      [TYPE]: 'tradle.Message',
      [SEQ]: 0,
      [SIG]: crypto.randomBytes(128).toString('base64'),
      time: 123,
      _payloadType: payload[TYPE],
      _author: crypto.randomBytes(32).toString('hex'),
      _recipient: crypto.randomBytes(32).toString('hex'),
      _link: crypto.randomBytes(32).toString('hex'),
      object: payload,
      recipientPubKey: JSON.parse(JSON.stringify({
        curve: 'p256',
        pub: crypto.randomBytes(64)
      })),
      _virtual: ['_author', '_recipient', '_link']
    }

    sinon.stub(objects, 'get').callsFake(async (link) => {
      if (link === message._link) {
        return message.object
      } else if (link === payload._link) {
        return payload
      }

      throw new Errors.NotFound(link)
    })

    sinon.stub(tradle.user, 'onSentMessage').callsFake(async () => {
      return message
    })

    // identities.byPermalink = async (permalink) => {
   //   t.equal(permalink, message.author)
    //   return bob.object
    // })

    bot.hook('message', async (data) => {
      const { user } = data
      user.bill = 'ted'
      // 2, 3, 4
      t.equal(user.id, message._author)
      t.same(data.message, message)
      t.same(data.payload, payload)
    })

    // const conversation = await bot.users.history('bob')
    // console.log(conversation)

    // #5
    const data = await IotMessage.encode({
      payload: { messages: [message] }
    })

    await bot.lambdas.onmessage().handler({
      // clientId: 'ted',
      data
    }, {
      done: t.error
    })

    // await bot.trigger('message', message)
    // #6
    t.equal(updatedUser, true)
    // identities.byPermalink = byPermalink
  }))

  test(`readseal (${mode})`, loudAsync(async (t) => {
    const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'

    let read
    let wrote
    const tradle = createTestTradle()
    const { seals, provider } = tradle
    const { getMyKeys } = provider
    provider.getMyKeys = () => Promise.resolve(aliceKeys)

    const bot = createBot({ tradle })
    bot.hook('readseal', async (event) => {
      read = true
      t.equal(event.link, link)
    })

    bot.hook('wroteseal', async (event) => {
      wrote = true
      t.equal(event.link, link)
    })

    await bot.lambdas.onsealstream().handler(toStreamItems([
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

  test(`use() (${mode})`, loudAsync(async (t) => {
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
        bot.hook(event, async (arg) => {
          t.equal(arg, expectedArg)
          called[event] = true
        })
      })
    })

    for (let event in called) {
      await bot.trigger(event, expectedArg)
      t.equal(called[event], true)
    }

    t.end()
  }))
})

test('onmessagestream', loudAsync(async (t) => {
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
    "_payloadType": "ping.pong.Ping",
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
    _t: 'ping.pong.Ping',
    _s: 'abc',
    _time: Date.now()
  }

  const tradle = createTestTradle()
  const bot = createRealBot({ tradle })
  bot.setMyCustomModels(PingPongModels)

  const table = await bot.db.getTableForModel('ping.pong.Ping')
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

  users.createIfNotExists = async (user) => {
    // #3
    t.equal(user.id, message._author)
    return user
  }

  bot.hook('message', async (data) => {
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
  })

  let updatedUser
  users.merge = async () => {
    updatedUser = true
  }

  await bot.lambdas.onmessagestream().handler(toStreamItems([
    { new: message }
  ]), {
    // #6
    done: t.error
  })

  const gql = getGraphqlAPI({ bot })
  const result = await gql.executeQuery(`
    {
      rl_ping_pong_Ping(orderBy:{
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
      "rl_ping_pong_Ping": {
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

  // const introspection = await bot.trigger('graphql', require('./introspection-query'))
  // console.log('introspection length', JSON.stringify(introspection).length)

  stubGet.restore()
  stubPreSign.restore()

  t.end()
}))

test('validate send', loudAsync(async (t) => {
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

  const bot = createRealBot({ tradle })
  bot.setMyCustomModels(models)
  try {
    await bot.send({
      to: bob.permalink,
      object: {}
    })

    t.fail('expected payload validation to fail')
  } catch (err) {
    t.ok(/expected/i.test(err.message))
  }

  // undeclared types are ok
  await bot.send({
    to: bob.permalink,
    object: {
      _t: 'sometype'
    }
  })

  // declared types are validated
  try {
    await bot.send({
      to: bob.permalink,
      object: {
        _t: 'ding.bling',
      }
    })

    t.fail('validation should have failed')
  } catch (err) {
    t.ok(/required/.test(err.message))
  }

  await bot.send({
    to: bob.permalink,
    object: {
      _t: 'ding.bling',
      ding: 'dong'
    }
  })

  t.end()
}))
