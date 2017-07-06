
const Cache = require('lru-cache')
const Resources = require('./resources')
const { getBucket } = require('./s3-utils')
const { cachify, extend } = require('./utils')
const { toCamelCase } = require('./string-utils')
// const BUCKET_NAMES = ['Secrets', 'Objects', 'PublicConf']
const cachifiable = {
  Objects: true
}

const CACHE_OPTS = {
  max: 200,
  maxAge: 60 * 1000
}

function loadBucket (name) {
  if (buckets[name]) return

  const physicalId = Resources.Bucket[name]
  if (!physicalId) throw new Error('bucket not found')

  const bucket = getBucket(physicalId)
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
}

const buckets = {}
Object.keys(Resources.Bucket).forEach(loadBucket)

module.exports = buckets
