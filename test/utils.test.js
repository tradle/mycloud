require('./env')

const test = require('tape')
const Cache = require('lru-cache')
const { getFavicon } = require('../lib/image-utils')
const { co, loudCo, cachify, clone, batchStringsBySize } = require('../lib/utils')
const wrap = require('../lib/wrap')

test('cachify', loudCo(function* (t) {
  const data = {
    a: 1
  }

  const misses = {}
  const raw = {
    get: co(function* (key, value) {
      misses[key] = (misses[key] || 0) + 1
      if (key in data) return data[key]

      throw new Error('not found')
    }),
    put: co(function* (key, value) {
      data[key] = value
    }),
    cache: new Cache({ max: 100 })
  }

  const cachified = cachify(raw)
  // miss
  t.equal(yield cachified.get('a'), data.a)
  t.equal(misses.a, 1)

  // hit
  t.equal(yield cachified.get('a'), data.a)
  t.equal(misses.a, 1)

  cachified.put('a', 2)
  // miss
  t.equal(yield cachified.get('a'), data.a)
  t.equal(misses.a, 2)

  cachified.put('a', 3)
  // miss
  // hit
  const miss = cachified.get('a')
  const hit = cachified.get('a')
  t.equal(yield miss, data.a)
  t.equal(misses.a, 3)
  t.equal(yield hit, data.a)

  t.end()
}))

test('wrap', loudCo(function* (t) {
  const lambdaUtils = require('../lib/lambda-utils')
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

  yield good.map(lambda => {
    return new Promise(resolve => {
      lambda({}, {}, function (err, result) {
        t.error(err)
        t.same(result, expectedRet)
        resolve()
      })
    })
  })

  yield bad.map(lambda => {
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

// test.only('favicon', loudCo(function* (t) {
//   const favicon = yield getFavicon('bankofamerica.com')
//   console.log(favicon)
// }))

function values (obj) {
  return Object.keys(obj).map(key => obj[key])
}
