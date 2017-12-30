
import Cache = require('lru-cache')
import { Bucket } from './bucket'
import { cachify, isPromise } from './utils'
import { toCamelCase } from './string-utils'
// const BUCKET_NAMES = ['Secrets', 'Objects', 'PublicConf']
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const MEG = 1024 * 1024
const byteLengthFn = val => {
  if (isPromise(val)) return 10000 // HACK
  if (typeof val === 'string' || Buffer.isBuffer(val)) {
    return Buffer.byteLength(val)
  }

  return Buffer.byteLength(JSON.stringify(val))
}

const cacheConfig = {
  Objects: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: Infinity //HOUR
  },
  Secrets: {
    max: 10, // 10 items
    maxAge: HOUR
  },
  ContentAddressed: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: Infinity
  },
  PublicConf: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: MINUTE
  },
  PrivateConf: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: MINUTE
  },
  FileUpload: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: 10 * MINUTE
  }
}

export type Buckets = {
  [name:string]: Bucket
}

export const getBuckets = ({ env, logger, aws, serviceMap }):Buckets => {

  const { MEMORY_SIZE } = env

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
