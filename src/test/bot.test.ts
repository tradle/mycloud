require('./env').install()

import crypto from 'crypto'
import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import test from 'tape'
import sinon from 'sinon'
import * as cfnResponse from '../cfn-response'
import createCredstash from 'nodecredstash'
import { TYPE, SEQ, SIG } from '@tradle/constants'
import IotMessage from '@tradle/iot-message'
import { utils as tradleUtils } from '@tradle/engine'
import {
  ILambdaAWSExecutionContext
} from '../types'
import { createTestBot } from '../'
import { createGraphqlAPI } from '../graphql'
import { loudAsync, wait } from '../utils'
import { topics as EventTopics } from '../events'
import { toStreamItems, recreateTable } from './utils'
import Errors from '../errors'
import { models as PingPongModels } from '../ping-pong-models'
import { Resource } from '../resource'
import { Secrets } from '../secrets'
const aliceKeys = require('./fixtures/alice/keys')
const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')
// const apiGatewayEvent = require('./fixtures/events/api-gateway')
const rethrow = err => {
  if (err) throw err
}

const fakeLink = () => crypto.randomBytes(32).toString('hex')
// test('await ready', loudAsync(async (t) => {
//   const bot = createBot({ tradle: createTestTradle() })
//   const expectedEvent = toStreamItems([
//     {
//       old: {
//         link: 'a',
//         unsealed: 'x'
//       },
//       value: {
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

test(`users `, loudAsync(async (t) => {
  const bot = createTestBot()
  const { users } = bot

  const isUpToDate = actual => {
    // mainly to ignore _time
    return _.isEqual(_.pick(actual, Object.keys(user)), actual)
  }

  // clean up, just in case
  try {
    await Promise.map(await users.list(), user => users.del(user.id))
  } catch (err) {}

  // const user : Object = {
  const user:any = {
    [TYPE]: users.type,
    id: bob.permalink,
    identity: bob.object,
  }

  const promiseOnCreate = new Promise(resolve => {
    bot.hook(EventTopics.user.create, ({ event }) => {
      resolve(event.user)
    })
  })

  t.ok(isUpToDate(await users.createIfNotExists(user)), 'create if not exists')
  t.ok(isUpToDate(await users.get(user.id)), user, 'get by primary key')

  // doesn't overwrite
  await users.createIfNotExists({
    id: user.id
  })

  t.ok(isUpToDate(await promiseOnCreate))
  t.ok(await users.get(user.id), user, '2nd create does not clobber')
  const list = await users.list()
  t.equal(list.length, 1)
  t.ok(isUpToDate(list[0]), 'list')

  user.name = 'bob'
  t.ok(isUpToDate(await users.merge(user)), 'merge')
  t.ok(isUpToDate(await users.get(user.id)), 'get after merge')
  t.ok(isUpToDate(await users.del(user.id)), 'delete')
  t.same(await users.list(), [], 'list')
  t.end()
}))

test('init', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const bot = createTestBot()
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
  sandbox.stub(bot.init, 'initInfra').callsFake(async (opts) => {
    t.same(opts, expectedEvent.payload)
  })

  const cfnResponseStub = sandbox.stub(cfnResponse, 'send').resolves()
  let { callCount } = cfnResponseStub

  // bot.oninit(async (event) => {
  //   t.same(event, expectedEvent)
  // })

  let initLambda = bot.lambdas.oninit()
  initLambda.use(async ({ event }) => {
    t.same(event, expectedEvent)
  })

  await initLambda.handler(originalEvent, {
    done: t.error
  } as ILambdaAWSExecutionContext)

  t.equal(cfnResponseStub.getCall(callCount++).args[2], cfnResponse.SUCCESS)

  // commented out as errors in oninit only lead to FAIL being sent
  // in cfn-response
  //
  // initLambda = bot.lambdas.oninit()
  // initLambda.use(async ({ event }) => {
  //   throw new Error('test error')
  // })

  // // @ts-ignore
  // await initLambda.handler(originalEvent, {
  //   done: err => t.equal(err.message, 'test error')
  // } as ILambdaAWSExecutionContext)

  // t.equal(cfnResponseStub.getCall(callCount++).args[2], cfnResponse.FAILED)

  sandbox.restore()
  t.end()
}))

test(`onmessage`, loudAsync(async (t) => {
  t.plan(6)

  const sandbox = sinon.createSandbox()
  const bot = createTestBot()
  const { objects, messages, identities } = bot
  const { users } = bot

  // let updatedUser
  // users.merge = async () => {
  //   updatedUser = true
  // }

  let creates = 0
  let resolveCreate
  const promiseCreates = new Promise(resolve => {
    resolveCreate = resolve
  })

  users.createIfNotExists = async (user) => {
    // #1, #2 (sync, stream)
    t.equal(user.id, message._author)
    if (++creates === 2) resolveCreate()
    return user
  }

  // const { byPermalink } = identities
  const payload = {
    _link: 'b',
    _permalink: 'b',
    _t: 'a',
    _s: 'sig',
    _author: 'carol',
    _time: 122
  }

  const message = {
    [TYPE]: 'tradle.Message',
    [SEQ]: 0,
    [SIG]: crypto.randomBytes(128).toString('base64'),
    _time: 123,
    _inbound: true,
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

  sandbox.stub(objects, 'get').callsFake(async (link) => {
    if (link === message._link) {
      return message.object
    } else if (link === payload._link) {
      return payload
    }

    throw new Errors.NotFound(link)
  })

  sandbox.stub(bot.userSim, 'onSentMessage').callsFake(async () => {
    return message
  })

  // identities.byPermalink = async (permalink) => {
 //   t.equal(permalink, message.author)
  //   return bob.object
  // })

  bot.hook('message', async ({ event }) => {
    const { user } = event
    user.bill = 'ted'
    // 2, 3, 4
    t.equal(user.id, message._author)
    t.same(event.message, message)
    t.same(event.payload, payload)
  })

  // const conversation = await bot.hookrs.history('bob')
  // console.log(conversation)

  // #5
  const data = await IotMessage.encode({
    type: 'messages',
    payload: [message]
  })

  sandbox.stub(bot.aws.iotData, 'publish').callsFake(() => ({
    promise: async () => {}
  }))

  await bot.lambdas.onmessage().handler({
    // clientId: 'ted',
    data
  }, {
    done: t.error
  } as ILambdaAWSExecutionContext)

  await promiseCreates
  sandbox.restore()
  // await bot.trigger('message', message)
  // #6
  // t.equal(updatedUser, true)
  // identities.byPermalink = byPermalink
}))

test(`seal events stream`, loudAsync(async (t) => {
  const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'

  let read
  let queuedWrite
  let wrote
  let watch
  const bot = createTestBot()
  const { seals, identity } = bot
  const sandbox = sinon.createSandbox()

  sandbox.stub(identity, 'getKeys').resolves(aliceKeys)

  const putEvents = sandbox.spy(bot.events, 'putEvents')

  bot.hook(EventTopics.seal.queuewrite.async, async ({ event }) => {
    queuedWrite = true
    t.equal(event.seal.link, link)
  })

  bot.hook(EventTopics.seal.wrote.async, async ({ event }) => {
    wrote = true
    t.equal(event.seal.link, link)
  })

  bot.hook(EventTopics.seal.read.async, async ({ event }) => {
    read = true
    t.equal(event.seal.link, link)
  })

  bot.hook(EventTopics.seal.watch.async, async ({ event }) => {
    watch = true
    t.equal(event.seal.link, link)
  })

  await bot.lambdas.onresourcestream().handler(toStreamItems(bot.tables.Bucket0.name, [
    // queueseal
    {
      value: {
        [TYPE]: 'tradle.SealState',
        link,
        unsealed: 'x',
        _time: 1
      }
    },
    // wroteseal
    {
      old: {
        [TYPE]: 'tradle.SealState',
        link,
        unsealed: 'x',
        _time: 1
      },
      value: {
        [TYPE]: 'tradle.SealState',
        link,
        unconfirmed: 'x',
        _time: 2
      }
    },
    // readseal
    {
      old: {
        [TYPE]: 'tradle.SealState',
        link,
        unconfirmed: 'x',
        _time: 2
      },
      value: {
        [TYPE]: 'tradle.SealState',
        link,
        _time: 3
      }
    },
    // watchseal
    {
      value: {
        [TYPE]: 'tradle.SealState',
        link,
        unconfirmed: 'x',
        _time: 4
      }
    }
  ]),
  // @ts-ignore
  {
    getRemainingTimeInMillis: () => 20000,
    done: t.error
  } as ILambdaAWSExecutionContext)

  t.equal(read, true)
  t.equal(wrote, true)
  t.equal(watch, true)
  t.equal(queuedWrite, true)
  t.equal(putEvents.callCount, 4)
  t.ok(putEvents.getCalls().every(call => call.args[0].length === 1))

  sandbox.restore()
  t.end()
}))

test('onmessagestream', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const _link = fakeLink()
  const inbound = {
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
      "_link": _link,
      "_permalink": _link,
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
    _time: Date.now(),
    _link: inbound.object._link
  }

  const bot = createTestBot()
  sinon.stub(bot.events, 'putEvents').callsFake(async (events) => {
    t.ok(events)
  })

  bot.setCustomModels({ models: PingPongModels })

  const table = bot.db.getTableForModel(PingPongModels['ping.pong.Ping'])
  // #1
  t.ok(table, 'table created per model')

  const { users } = bot

  const stubGet = sandbox.stub(bot.objects, 'get').callsFake(async (link) => {
    // #2
    t.equal(link, inbound.object._link)
    return payload
  })

  const stubPreSign = sandbox.stub(bot.objects, 'presignEmbeddedMediaLinks')
    .callsFake(object => object)

  let createdUser
  users.createIfNotExists = async (user) => {
    // #3
    t.equal(user.id, inbound._author)
    createdUser = user
    return user
  }

  bot.hook(EventTopics.message.inbound.async, async ({ event }) => {
    // #4, 5
    const { user } = event
    user.bill = 'ted'
    t.equal(user.id, inbound._author)
    const expected = {
      ...inbound,
      object: {
        ...inbound.object,
        ...payload
      }
    }

    t.same(event.message, expected)
  })

  // const sent = await bot.send({
  //   to: message._author,
  //   object: await bot.sign({
  //     [TYPE]: 'tradle.SimpleMessage',
  //     message: 'hey'
  //   })
  //   // [TYPE]: 'tradle.Message',
  //   // recipientPubKey: 'abc',
  //   // object: await bot.sign({
  //   //   [TYPE]: 'tradle.SimpleMessage',
  //   //   message: 'hey'
  //   // }),
  //   // _time: 123
  // })

  await bot.lambdas.onresourcestream().handler(toStreamItems(bot.tables.Bucket0.name, [
    { value: inbound }
  ]),
  // @ts-ignore
  {
    // #6
    getRemainingTimeInMillis: () => 20000,
    done: t.error
  } as ILambdaAWSExecutionContext)

  sandbox.stub(bot.users, 'get').callsFake(async (id) => {
    if (id === inbound._author) {
      return createdUser
    }

    throw new Errors.NotFound(id)
  })

  const outbound = {
    ...inbound,
    _author: inbound._recipient,
    _recipient: inbound._author,
    _inbound: false
  }

  bot.hook(EventTopics.message.outbound.async, async ({ event }) => {
    // #4, 5
    const { user } = event
    t.equal(user.id, outbound._recipient)
    t.same(event.message, {
      ...outbound, object: {
        ...outbound.object,
        ...payload
      }
    })
  })

  await bot.lambdas.onresourcestream().handler(toStreamItems(bot.tables.Bucket0.name, [
    { value: outbound }
  ]), {
    // #6
    done: t.error
  } as ILambdaAWSExecutionContext)

  // const result = await bot.graphql.execute(`
  //   {
  //     rl_ping_pong_Ping(orderBy:{
  //       property: _time
  //     }) {
  //       edges {
  //         node {
  //           _link
  //         }
  //       }
  //     }
  //   }
  // `)

  // // #7
  // t.same(result, {
  //   "data": {
  //     "rl_ping_pong_Ping": {
  //       "edges": [
  //         {
  //           "node": {
  //             "_link": message.object._link
  //           }
  //         }
  //       ]
  //     }
  //   }
  // })

  // const introspection = await bot.trigger('graphql', require('./introspection-query'))
  // console.log('introspection length', JSON.stringify(introspection).length)

  t.ok(createdUser)
  sandbox.restore()

  t.end()
}))

test('validate send', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const bot = createTestBot()
  sandbox.stub(bot.messaging, 'queueMessage').resolves({})
  sandbox.stub(bot.messaging, 'queueMessageBatch').resolves([])

  const models = {
    'ding.bling': {
      id: 'ding.bling.Ding',
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

  sandbox.stub(bot.users, 'get').callsFake(async (id) => {
    if (id === bob.permalink) return { id, identity: bob.object }

    throw new Errors.NotFound(id)
  })

  bot.setCustomModels({ models })
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
        _t: 'ding.bling.Ding',
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

  sandbox.restore()
  t.end()
}))

test('secrets', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const bot = createTestBot()
  const folder = 'test-' + Date.now()
  const obfuscateSecretName = name => name.repeat(2)
  const secrets = new Secrets({
    obfuscateSecretName,
    credstash: createCredstash({
      algorithm: 'aes-256-gcm',
      kmsKey: bot.defaultEncryptionKey,
      store: createCredstash.store.s3({
        client: bot.aws.s3,
        bucket: bot.buckets.Secrets.name,
        folder
      })
    })
  })

  const jsonValue = { 'efg': 1 }

  await secrets.put({
    key: 'a',
    value: jsonValue
  })

  t.same(JSON.parse(await secrets.get({ key: 'a' })), jsonValue)

  const bufValue = new Buffer('be excellent to each other')
  await secrets.put({
    key: 'b',
    value: bufValue
  })

  t.same(await secrets.get({ key: 'b' }), bufValue)
  t.ok(await bot.buckets.Secrets.get(`${folder}/${obfuscateSecretName('a')}`))

  t.end()
}))

// test.only('sign / save / version', loudAsync(async (t) => {
//   const sandbox = sinon.createSandbox()
//   const tradle = createTestTradle()
//   const bot = createBot({ tradle })
//   const v1 = bot.signAndSave()
// }))
