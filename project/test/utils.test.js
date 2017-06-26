require('./env')

const test = require('tape')
const Cache = require('lru-cache')
const { co, loudCo, cachify, clone } = require('../lib/utils')

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
