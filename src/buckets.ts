
import Cache = require('lru-cache')
import { Bucket } from './bucket'
import { cachify, extend } from './utils'
import { toCamelCase } from './string-utils'
import { Bucket } from './bucket'
// const BUCKET_NAMES = ['Secrets', 'Objects', 'PublicConf']
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const cacheConfig = {
  Objects: {
    max: 500,
    maxAge: HOUR
  },
  Secrets: {
    max: 10,
    maxAge: MINUTE
  },
  ContentAddressed: {
    max: 500,
    maxAge: HOUR
  },
  PublicConf: {
    max: 10,
    maxAge: MINUTE
  },
  PrivateConf: {
    max: 10,
    maxAge: MINUTE
  },
  FileUpload: {
    max: 50,
    maxAge: 10 * MINUTE
  }
}

const CACHE_OPTS = {
  max: 500,
  maxAge: 60 * 1000 * 1000
}

type Buckets = {
  [name:string]: Bucket
}

module.exports = function getBuckets ({ logger, aws, serviceMap }):Buckets {

  function loadBucket (name) {
    if (buckets[name]) return

    const physicalId = serviceMap.Bucket[name]
    if (!physicalId) throw new Error('bucket not found')

    buckets[name] = new Bucket({
      name: physicalId,
      s3: aws.s3,
      cache: cacheConfig[name] && new Cache(cacheConfig[name]),
      logger: logger.sub(`bucket:${name}`)
    })
  }

  const buckets:Buckets = {}
  Object.keys(serviceMap.Bucket).forEach(loadBucket)
  return buckets
}
