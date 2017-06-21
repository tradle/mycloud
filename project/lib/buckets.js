
const Cache = require('lru-cache')
const ENV = require('./env')
const { getBucket } = require('./s3-utils')
const { cachify, extend } = require('./utils')
const { toCamelCase } = require('./string-utils')
const buckets = {}
const cachifiable = {
  ObjectsBucket: true
}

const CACHE_OPTS = {
  max: 200,
  maxAge: 1000 * 60 * 60
}

Object.keys(ENV)
  .filter(prop => prop.endsWith('_BUCKET'))
  .forEach(prop => {
    const name = toCamelCase(prop, '_', true)
    const bucket = getBucket(ENV[prop])
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
