require('./env').install()

import test = require('tape')
import Cache = require('lru-cache')
import sinon = require('sinon')
import Logger from '../logger'
import KeyValueTable from '../key-value-table'
// import { getFavicon } from '../samplebot/image-utils'
import { randomString, sha256, rawSign, rawVerify, ECKey } from '../crypto'
import {
  loudAsync,
  firstSuccess,
  cachify,
  cachifyFunction,
  clone,
  batchStringsBySize,
  promisify,
  wrap,
  wait,
  timeoutIn,
  batchProcess
} from '../utils'
import Errors = require('../errors')
import { KVTable } from '../definitions'
import aliceKeys = require('./fixtures/alice/keys')
import { Tradle } from '../'
import { Bucket } from '../bucket'
import { createSilentLogger } from './utils'

const tradle = new Tradle()
const { dbUtils } = tradle

test('cachify', loudAsync(async (t) => {
  const data = {
    a: 1
  }

  const misses = {}
  const raw = {
    get: async (key, value) => {
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
      return await actions[i++](...args)
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

  t.same(batchStringsBySize(input, MAX), expected)
  t.end()
})

test('getCacheable', loudAsync(async (t) => {
  const { aws } = tradle
  const { s3 } = aws
  const bucketName = `test-${Date.now()}-${randomString(10)}`
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
  const { aws } = tradle
  const { s3 } = aws
  const bucketName = `test-${Date.now()}-${randomString(10)}`
  const bucket = new Bucket({ name: bucketName, s3 })
  await bucket.create()

  const ops = [
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
  const { aws } = tradle
  const { s3 } = aws
  const bucketName = `test-${Date.now()}-${randomString(10)}`
  const bucket = new Bucket({
    name: bucketName,
    s3,
    cache: new Cache({ maxAge: 500 })
  })

  await bucket.create()

  const ops = [
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
      getObjStub = sinon.stub(s3, 'getObject').callsFake(() => {
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
  t.end()
}))

test('content-addressed-storage', loudAsync(async (t) => {
  const { contentAddressedStorage } = tradle
  const key = await contentAddressedStorage.put('a')
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

test('errors', function (t) {
  ;[
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
        const err = new Error('resource not found')
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
    },
  ].forEach(({ error, matches }) => {
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
    timeoutIn(150)
  ]

  const failed = [
    timeoutIn(0),
    timeoutIn(50)
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
      timeoutIn(0),
      timeoutIn(50),
      timeoutIn(100)
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

// test.only('favicon', loudAsync(async (t) => {
//   const favicon = await getFavicon('bankofamerica.com')
//   console.log(favicon)
// }))

function values (obj) {
  return Object.keys(obj).map(key => obj[key])
}

function sum (arr) {
  return arr.reduce((total, one) => total + one, 0)
}
