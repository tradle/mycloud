
import Cache = require('lru-cache')
import { Bucket } from './bucket'
import { cachify, extend } from './utils'
import { toCamelCase } from './string-utils'
import { Bucket } from './bucket'
// const BUCKET_NAMES = ['Secrets', 'Objects', 'PublicConf']
const cachifiable = {
  Objects: true,
  ContentAddressed: true
}

const CACHE_OPTS = {
  max: 200,
  maxAge: 60 * 1000
}

type Buckets = {
  [name:string]: Bucket
}

module.exports = function getBuckets ({ aws, resources }):Buckets {

  function loadBucket (name) {
    if (buckets[name]) return

    const physicalId = resources.Bucket[name]
    if (!physicalId) throw new Error('bucket not found')

    const bucket = new Bucket({ name: physicalId, s3: aws.s3 })
    if (cachifiable[name]) {
      // TODO: resolve the duplicate efforts of this
      // and Bucket.getCachable
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

  const buckets:Buckets = {}
  Object.keys(resources.Bucket).forEach(loadBucket)
  return buckets
}
