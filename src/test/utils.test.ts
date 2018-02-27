require('./env').install()

import test = require('tape')
import _ = require('lodash')
import Cache = require('lru-cache')
import sinon = require('sinon')
import { SIG } from '@tradle/constants'
import ModelsPack = require('@tradle/models-pack')
import Logger from '../logger'
import KeyValueTable from '../key-value-table'
import { getFaviconUrl } from '../in-house-bot/image-utils'
import { randomString, sha256, rawSign, rawVerify, ECKey } from '../crypto'
import {
  loudAsync,
  firstSuccess,
  cachify,
  cachifyFunction,
  cachifyPromiser,
  clone,
  batchByByteLength,
  promisify,
  wrap,
  wait,
  timeoutIn,
  batchProcess,
  toModelsMap,
  stableStringify
} from '../utils'
import Errors = require('../errors')
import { Tradle, createTestTradle } from '../'
import { Bucket } from '../bucket'
import { createSilentLogger } from './utils'
import { ModelStore, createModelStore } from '../model-store'
import { models as PingPongModels } from '../bot/ping-pong-models'
import constants = require('../constants')

const { KVTable } = require('../definitions')
const aliceKeys = require('./fixtures/alice/keys')

const tradle = new Tradle()
const { dbUtils } = tradle

interface IErrorMatch {
  type: any
  result: boolean
}

interface IErrorMatchTest {
  error: any
  matches: IErrorMatch[]
}

test('cachify', loudAsync(async (t) => {
  const data = {
    a: 1
  }

  const misses:any = {}
  const raw = {
    get: async (key) => {
      misses[key] = (misses[key] || 0) + 1
      if (key in data) return data[key]

      throw new Error('not found')
    },
    put: async (key, value) => {
      data[key] = value
    },
    del: async (key) => {
      delete data[key]
    },
    cache: new Cache({ max: 100 })
  }

  const cachified = cachify(raw)
  // miss
  t.equal(await cachified.get('a'), data.a)
  t.equal(misses.a, 1)

  // hit
  t.equal(await cachified.get('a'), data.a)
  t.equal(misses.a, 1)

  cachified.put('a', 2)
  // miss
  t.equal(await cachified.get('a'), data.a)
  t.equal(misses.a, 2)

  cachified.put('a', 3)
  // miss
  // hit
  const miss = cachified.get('a')
  const hit = cachified.get('a')
  t.equal(await miss, data.a)
  t.equal(misses.a, 3)
  t.equal(await hit, data.a)

  t.end()
}))

test('cachifyFunction', loudAsync(async (t) => {
  const actions = [
    async () => {
      throw new Error('test fail a')
    },
    async () => {
      return 'a'
    }
  ]

  const container = {
    cache: new Cache({ max: 100 }),
    logger: createSilentLogger(),
    fn: async (...args) => {
      return await actions[i++]()
    }
  }

  let i = 0
  const cachified = cachifyFunction(container, 'fn')
  try {
    await cachified()
    t.fail('expected error')
  } catch (err) {
    t.equal(err.message, 'test fail a')
  }

  t.equal(i, 1)
  t.equal(await cachified(), 'a')
  t.equal(i, 2)
  t.equal(await cachified(), 'a')
  t.equal(i, 2)
  t.end()
}))

test('cachifyPromiser', loudAsync(async (t) => {
  const actions = [
    async () => {
      throw new Error('test err')
    },
    async () => {
      return 'a'
    }
  ]

  let i = 0
  const fn = cachifyPromiser(() => actions[i++]())

  try {
    await fn()
    t.fail('expected error')
  } catch (err) {
    t.equal(err.message, 'test err')
  }

  t.equal(await fn(), 'a')
  t.equal(await fn(), 'a')
  try {
    fn('something')
    t.fail('expected error')
  } catch (err) {
    t.ok(/arguments/.test(err.message))
  }

  t.end()
}))

test('wrap', loudAsync(async (t) => {
  const lambdaUtils = require('../lambda-utils')
  const { performServiceDiscovery } = lambdaUtils
  lambdaUtils.performServiceDiscovery = () => Promise.resolve()

  const expectedRet = {
    something: 'good'
  }

  const expectedError = new Error('blah happened')

  const originals = {
    good: {
      generatorSuccess: function* () {
        return expectedRet
      },
      promiserSuccess: function () {
        return Promise.resolve(expectedRet)
      },
      syncSuccess: function () {
        return expectedRet
      }
    },
    bad: {
      generatorError: function* () {
        throw expectedError
      },
      promiserError: function () {
        return Promise.reject(expectedError)
      },
      syncError: function () {
        throw expectedError
      }
    }
  }

  const good = values(originals.good).map(wrap)
  const bad = values(originals.bad).map(wrap)
  // eslint-disable-next-line no-mixed-operators
  let togo = good.length * 2 + bad.length

  await good.map(lambda => {
    return new Promise(resolve => {
      lambda({}, {}, function (err, result) {
        t.error(err)
        t.same(result, expectedRet)
        resolve()
      })
    })
  })

  await bad.map(lambda => {
    return new Promise(resolve => {
      lambda({}, {}, function (err, result) {
        t.equal(err, expectedError)
        resolve()
      })
    })
  })

  lambdaUtils.performServiceDiscovery = performServiceDiscovery
  t.end()
}))

test('batch by size', function (t) {
  const sampleJSON = {
    blah: 1,
    url: 'http://blah.com/blah?blah=blah#blah=blah%$^*)_@#*('
  }

  const s = JSON.stringify(sampleJSON)
  const length = Buffer.byteLength(s, 'utf8')
  const MAX = length
  const oneThird = Math.floor(length / 3)
  const twoFifths = Math.floor(2 * length / 5)
  const threeFifths = Math.floor(3 * length / 5)
  const leftOver = length - twoFifths - threeFifths
  const expected = [
    // 0
    [
      s,
    ],
    // 1
    [
      s.slice(0, oneThird),
      s.slice(0, oneThird),
      s.slice(0, oneThird),
    ],
    // // 2
    [
      s.slice(0, twoFifths),
      s.slice(0, twoFifths),
    ],
    // 3
    [
      s.slice(0, twoFifths),
      s.slice(0, threeFifths),
      'a'.repeat(leftOver)
    ],
    [
      'a'
    ]
  ]

  const input = expected.reduce((arr, next) => arr.concat(next), [])

  t.same(batchByByteLength(input, MAX), expected)
  t.end()
})

test('getCacheable', loudAsync(async (t) => {
  const { aws } = tradle
  const { s3 } = aws
  const bucketName = `test-${randomString(10)}`
  const bucket = new Bucket({ name: bucketName, s3 })
  await bucket.create()

  const key = 'a'
  const cacheable = bucket.getCacheable({
    key,
    parse: JSON.parse.bind(JSON),
    ttl: 100
  })

  try {
    await cacheable.get()
    t.fail('expected error')
  } catch (err) {
    t.equal(err.name, 'NotFound')
  }

  let value = { a: 1 }
  await cacheable.put({ value })

  const getObjectSpy = sinon.spy(s3, 'getObject')
  t.same(await cacheable.get(), value)
  t.equal(getObjectSpy.callCount, 0)
  t.same(await cacheable.get(), value)
  t.equal(getObjectSpy.callCount, 0)

  value = { a: 2 }
  await bucket.putJSON(key, value)
  await new Promise(resolve => setTimeout(resolve, 200))
  t.same(await cacheable.get(), value)
  t.equal(getObjectSpy.callCount, 1)
  t.same(await cacheable.get(), value)
  t.equal(getObjectSpy.callCount, 1)

  getObjectSpy.restore()
  await bucket.del(key)
  await s3.deleteBucket({ Bucket: bucketName }).promise()

  t.end()
}))

test('Bucket', loudAsync(async (t) => {
  const { aws, env } = tradle
  const { s3 } = aws
  const bucketName = `test-${Date.now()}-${randomString(10)}`
  const bucket = new Bucket({ name: bucketName, s3, env })
  await bucket.create()

  const ops:any[] = [
    { method: 'exists', args: ['abc'], result: false },
    { method: 'get', args: ['abc'], error: 'NotFound' },
    { method: 'getJSON', args: ['abc'], error: 'NotFound' },
    { method: 'put', args: ['abc', { cba: 1 }] },
    { method: 'exists', args: ['abc'], result: true },
    { method: 'get', args: ['abc'], body: new Buffer(JSON.stringify({ cba: 1 })) },
    { method: 'getJSON', args: ['abc'], result: { cba: 1 } },
    { method: 'del', args: ['abc'] },
    { method: 'exists', args: ['abc'], result: false },
    { method: 'exists', args: ['abcd'], result: false },
    { method: 'del', args: ['abcd'], result: {} },
    { method: 'getJSON', args: ['abc'], error: 'NotFound' },
    { method: 'gzipAndPut', args: ['abc', { cba: 1 }] },
    { method: 'getJSON', args: ['abc'], result: { cba: 1 } },
    { method: 'del', args: ['abc'], result: {} },
  ]

  for (const op of ops) {
    const { method, args, result, body, error } = op
    try {
      const actualResult = await bucket[method](...args)
      if (error) {
        t.fail(`expected error: ${error}`)
      } else if (typeof result !== 'undefined') {
        t.same(actualResult, result)
      } else if (typeof body !== 'undefined') {
        t.same(actualResult.Body, body)
      }
    } catch (err) {
      t.equal(err.name, error)
    }
  }

  await bucket.destroy()
  t.end()
}))

test('Bucket with cache', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const { aws } = tradle
  const { s3 } = aws
  const bucketName = `test-${Date.now()}-${randomString(10)}`
  const bucket = new Bucket({
    name: bucketName,
    s3,
    cache: new Cache({ maxAge: 500 })
  })

  await bucket.create()

  const ops:any[] = [
    { method: 'exists', args: ['abc'], result: false },
    { method: 'get', args: ['abc'], error: 'NotFound' },
    { method: 'getJSON', args: ['abc'], error: 'NotFound' },
    { method: 'putJSON', args: ['abc', { cba: 1 }] },
    { method: 'exists', args: ['abc'], result: true },
    { method: 'get', args: ['abc'], body: new Buffer(JSON.stringify({ cba: 1 })) },
    { method: 'getJSON', args: ['abc'], result: { cba: 1 }, cached: true },
    { method: 'del', args: ['abc'] },
    { method: 'exists', args: ['abc'], result: false },
    { method: 'exists', args: ['abcd'], result: false },
    { method: 'del', args: ['abcd'], result: {} },
  ]

  for (const op of ops) {
    const { method, args, result, body, cached, error } = op
    let getObjStub
    if (cached) {
      getObjStub = sandbox.stub(s3, 'getObject').callsFake(() => {
        t.fail('expected object to be cached')
      })
    }

    try {
      const actualResult = await bucket[method](...args)
      if (error) {
        t.fail(`expected error: ${error}`)
      } else if (typeof result !== 'undefined') {
        t.same(actualResult, result)
      } else if (typeof body !== 'undefined') {
        t.same(actualResult.Body, body)
      }
    } catch (err) {
      t.equal(err.name, error)
    } finally {
      if (getObjStub) {
        getObjStub.restore()
      }
    }
  }

  await bucket.destroy()
  sandbox.restore()
  t.end()
}))

test('content-addressed-storage', loudAsync(async (t) => {
  const { contentAddressedStore } = tradle
  const key = await contentAddressedStore.put('a')
  t.equal(key, sha256('a', 'hex'))
  t.end()
}))

test('key-value table', loudAsync(async (t) => {
  const newTableName = 'kvTable' + Date.now()
  const { aws } = tradle

  await aws.dynamodb.createTable({
    ...KVTable.Properties,
    TableName: newTableName
  }).promise()

  const table = dbUtils.getTable(newTableName)
  const conf = new KeyValueTable({ table })
  t.equal(await conf.exists('a'), false)

  await conf.put('a', {
    b: 'c',
    age: 75
  })

  t.equal(await conf.exists('a'), true)
  t.same(await conf.get('a'), {
    b: 'c',
    age: 75
  })

  const update = await conf.update('a', {
    UpdateExpression: 'SET #value.#age = #value.#age + :incr',
    ExpressionAttributeNames: {
      '#value': 'value',
      '#age': 'age'
    },
    ExpressionAttributeValues: {
      ':incr': 1
    },
    ReturnValues: 'UPDATED_NEW'
  })

  t.same(update.age, 76)

  const sub = conf.sub('mynamespace:')
  t.equal(await sub.exists('a'), false)
  try {
    await sub.get('mynamespace:a')
    t.fail('sub should not have value')
  } catch (err) {
    t.ok(err)
  }

  await sub.put('a', {
    d: 'e'
  })

  t.equal(await sub.exists('a'), true)
  t.same(await sub.get('a'), {
    d: 'e'
  })

  t.equal(await conf.exists('mynamespace:a'), true)
  t.same(await conf.get('mynamespace:a'), {
    d: 'e'
  })

  await sub.del('a')
  t.equal(await sub.exists('a'), false)
  try {
    await sub.get('a')
    t.fail('sub should not have value')
  } catch (err) {
    t.ok(err)
  }

  await table.destroy()
  t.end()
}))

test('errors', t => {
  const tests:IErrorMatchTest[] = [
    {
      error: new TypeError('bad type'),
      matches: [
        { type: 'system', result: true },
        { type: { message: 'bad type' }, result: true },
        { type: { message: /bad type/ }, result: true },
        { type: {}, result: true }
      ]
    },
    {
      error: (() => {
        const err:any = new Error('resource not found')
        err.code = 'ResourceNotFoundException'
        err.name = 'somename'
        return err
      })(),
      matches: [
        {
          type: 'system',
          result: false
        },
        {
          type: {
            code: 'ResourceNotFoundException'
          },
          result: true
        },
        {
          type: {
            code: 'ResourceNotFoundException',
            name: 'someothername'
          },
          result: false
        },
        { type: {}, result: true }
      ]
    }
  ]

  tests.forEach(({ error, matches }) => {
    matches.forEach(({ type, result }) => {
      t.equal(Errors.matches(error, type), result)
    })
  })

  t.end()
})

test('sign/verify', loudAsync(async (t) => {
  const key = aliceKeys.find(key => key.type === 'ec')
  const sig = rawSign(key.encoded.pem.priv, 'a')
  t.ok(rawVerify(key.encoded.pem.pub, 'a', new Buffer(sig, 'hex')))
  t.notOk(rawVerify(key.encoded.pem.pub, 'a1', sig))

  const ecKey = new ECKey(key)
  const sig1 = ecKey.signSync('b')
  t.ok(ecKey.verifySync('b', sig1))
  t.notOk(ecKey.verifySync('b', sig))
  t.notOk(ecKey.verifySync('b1', sig1))

  const sig2 = await promisify(ecKey.sign)('c')
  t.ok(await promisify(ecKey.verify)('c', sig2))
  t.notOk(await promisify(ecKey.verify)('c', sig))
  t.notOk(await promisify(ecKey.verify)('c1', sig2))

  const sig3 = await ecKey.promiseSign('d')
  t.ok(await ecKey.promiseVerify('d', sig3))
  t.notOk(await ecKey.promiseVerify('d', sig))
  t.notOk(await ecKey.promiseVerify('d1', sig3))

  t.end()
}))

test('first success', loudAsync(async (t) => {
  const pending = [
    wait(200).then(() => 200),
    timeoutIn({ millis:150 })
  ]

  const failed = [
    timeoutIn({ millis:0 }),
    timeoutIn({ millis:50 })
  ]

  const resolved = [
    wait(100).then(() => 100)
  ]

  const result = await firstSuccess(pending.concat(failed).concat(resolved))
  t.equal(result, 100)
  failed.forEach(promise => t.equal(promise.isRejected(), true))
  resolved.forEach(promise => t.equal(promise.isResolved(), true))
  pending.forEach(promise => t.equal(promise.isPending(), true))

  try {
    await firstSuccess([
      timeoutIn({ millis:0 }),
      timeoutIn({ millis:50 }),
      timeoutIn({ millis:100 })
    ])

    t.fail('expected error')
  } catch (err) {
    t.ok(err)
  }

  t.end()
}))

test('batchProcess', loudAsync(async (t) => {
  let i = 0

  // series
  await batchProcess({
    data: [0, 1, 2],
    batchSize: 10,
    series: true,
    processOne: (num) => {
      t.equal(num, i++)
      return wait(10)
    }
  })

  // parallel
  let time = Date.now()
  await batchProcess({
    data: [100, 100, 100],
    batchSize: 10,
    processOne: wait
  })

  t.ok(Math.abs(Date.now() - time - 100) < 50)
  time = Date.now()

  // parallel, limited batch size
  await batchProcess({
    data: [100, 100, 100],
    batchSize: 1,
    processOne: wait
  })

  t.ok(Math.abs(Date.now() - time - 300) < 50)

  // parallel, limited batch size
  let results = await batchProcess({
    data: [100, 100, 100],
    batchSize: 1,
    processOne: timeoutIn,
    settle: true
  })

  t.ok(results.every(r => r.reason))

  time = Date.now()
  // parallel, process batch
  results = await batchProcess({
    data: [100, 100, 100, 100],
    batchSize: 2,
    processBatch: batch => {
      t.equal(batch.length, 2)
      return wait(sum(batch))
    },
    settle: true
  })

  t.ok(Math.abs(Date.now() - time - 400) < 50)

  time = Date.now()
  // series, process batch
  results = await batchProcess({
    data: [100, 100, 100, 100],
    batchSize: 2,
    processOne: wait,
    series: true,
    settle: true
  })

  t.ok(Math.abs(Date.now() - time - 400) < 50)

  t.end()
}))

test('ModelStore', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const testPrefix = 'test'
  const friend1 = {
    _identityPermalink: testPrefix + '1',
    domain: `${testPrefix}.example1.com`
  }

  const friend2 = {
    _identityPermalink: Date.now() + '2',
    domain: `${testPrefix}.example2.com`
  }

  const tradle = createTestTradle()
  const store = createModelStore(tradle)
  let memBucket = {}
  const fakePut = async ({ key, value }) => {
    memBucket[key] = value
  }

  const fakeGet = async ({ key }) => {
    if (!(key in memBucket)) {
      throw new Errors.NotFound(key)
    }

    return memBucket[key]
  }

  // sandbox.stub(tradle.s3Utils, 'put').callsFake(fakePut)
  // sandbox.stub(tradle.s3Utils, 'gzipAndPut').callsFake(fakePut)
  sandbox.stub(tradle.s3Utils, 'get').callsFake(async ({ key }) => {
    const Body = await fakeGet({ key })
    return {
      Body: new Buffer(JSON.stringify(Body))
    }
  })

  // sandbox.stub(tradle.s3Utils, 'getJSON').callsFake(fakeGet)
  sandbox.stub(store.bucket, 'get').callsFake(key => fakeGet({ key }))
  sandbox.stub(store.bucket, 'getJSON').callsFake(key => fakeGet({ key }))
  sandbox.stub(store.bucket, 'gzipAndPut').callsFake((key, value) => fakePut({ key, value }))
  sandbox.stub(tradle.friends, 'getByDomain').callsFake(async (domain) => {
    if (domain === friend1.domain) return friend1
    if (domain === friend2.domain) return friend2

    throw new Errors.NotFound(`friend for domain: ${domain}`)
  })

  try {
    await store.getModelsPackByDomain(friend1.domain)
    t.fail('expected error')
  } catch (err) {
    // 1
    t.equal(Errors.matches(err, Errors.NotFound), true)
  }

  const namespace = domainToNamespace(friend1.domain)
  const modelsPack = ModelsPack.pack({
    models: [
      {
        type: 'tradle.Model',
        id: `${namespace}.Name`,
        title: 'Custom Name',
        properties: {
          name: {
            type: 'string'
          }
        }
      }
    ]
  })

  try {
    await store.addModelsPack({ modelsPack })
    t.fail('expected error')
  } catch (err) {
    // 2
    t.ok(/namespace/.test(err.message))
  }

  modelsPack.namespace = namespace
  modelsPack._author = 'abc'
  try {
    await store.addModelsPack({ modelsPack })
    t.fail('expected error')
  } catch (err) {
    // 3
    t.ok(/domain/i.test(err.message))
  }

  modelsPack._author = friend1._identityPermalink
  await store.addModelsPack({ modelsPack })
  // 4
  t.same(await store.getModelsPackByDomain(friend1.domain), modelsPack)
  // 5
  t.same(
    await store.getCumulativeModelsPack(),
    _.omit(modelsPack, 'namespace'),
    'models pack added to cumulative pack'
  )

  await store.saveCustomModels({
    modelsPack: {
      namespace: 'ping.pong',
      models: _.values(PingPongModels)
    }
  })

  let cumulative = await store.getCumulativeModelsPack()
  let isCumulative = modelsPack.models.concat(_.values(PingPongModels)).every(model => {
    return cumulative.models.find(m => m.id === model.id)
  })

  // 6
  t.equal(isCumulative, true, 'my custom models added to cumulative models pack')

  const namespace2 = domainToNamespace(friend2.domain)
  const modelsPack2 = ModelsPack.pack({
    namespace: namespace2,
    models: [
      {
        type: 'tradle.Model',
        id: `${namespace2}.Name`,
        title: 'Custom Name1',
        properties: {
          name: {
            type: 'string'
          }
        }
      }
    ]
  })

  modelsPack2._author = friend2._identityPermalink
  try {
    await store.addModelsPack({
      modelsPack: {
        ...modelsPack2,
        namespace
      }
    })

    t.fail('expected validation to fail')
  } catch (err) {
    // 7
    t.ok(/domain|namespace/i.test(err.message))
  }

  console.log('patience...')
  await store.addModelsPack({ modelsPack: modelsPack2 })
  cumulative = await store.getCumulativeModelsPack()
  isCumulative = modelsPack.models
    .concat(modelsPack2.models)
    .concat(_.values(PingPongModels))
    .every(model => {
      return cumulative.models.find(m => m.id === model.id)
    })

  // 8
  t.equal(isCumulative, true)

  // console.log('patience...')
  // const schema = await store.getSavedGraphqlSchema()

  // 9
  // t.ok(schema)

  sandbox.restore()
  t.end()
}))

// test.only('favicon', loudAsync(async (t) => {
//   const favicon = await getFaviconUrl('tradle.io')
//   console.log(favicon)
//   t.end()
// }))

function values (obj) {
  return Object.keys(obj).map(key => obj[key])
}

function sum (arr) {
  return arr.reduce((total, one) => total + one, 0)
}

const domainToNamespace = domain => domain.split('.').reverse().join('.')
