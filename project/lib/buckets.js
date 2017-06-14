
const Cache = require('lru-cache')
const ENV = require('./env')
const { getBucket } = require('./s3-utils')
const { toCamelCase, cachify, extend } = require('./utils')
const buckets = {}
const cachifiable = {
  ObjectsBucket: true
}

const CACHE_OPTS = {
  max: 200,
  maxAge: 1000 * 60 * 60
}

Object.keys(ENV).forEach(prop => {
  if (!prop.endsWith('_BUCKET')) return

  let name = toCamelCase(prop, '_', true)
  let bucket = getBucket(ENV[prop])
  if (cachifiable[name]) {
    const cachified = cachify({
      get: bucket.getJSON,
      put: bucket.putJSON,
      cache: new Cache(CACHE_OPTS)
    })

    bucket.getJSON = cachified.get
    bucket.putJSON = cachified.put
  }

  buckets[name] = bucket
})

module.exports = buckets
