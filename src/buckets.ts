
import Cache from 'lru-cache'
import { Bucket } from './bucket'
import { IBucketsInfo, Buckets } from './types'
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

const cacheConfig:IBucketsInfo = {
  Objects: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: Infinity // HOUR
  },
  Secrets: {
    max: 10, // 10 items
    maxAge: HOUR
  },
  Logs: {
    length: byteLengthFn,
    max: 100 * MEG,
    maxAge: Infinity
  },
  // ContentAddressed: {
  //   length: byteLengthFn,
  //   max: 50 * MEG,
  //   maxAge: Infinity
  // },
  // PublicConf: {
  //   length: byteLengthFn,
  //   max: 50 * MEG,
  //   maxAge: MINUTE
  // },
  PrivateConf: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: MINUTE
  },
  FileUpload: {
    length: byteLengthFn,
    max: 50 * MEG,
    maxAge: 10 * MINUTE
  },
  ServerlessDeployment: {
    max: 100 * MEG,
    maxAge: Infinity
  }
}

export const getBuckets = ({ env, logger, aws, serviceMap, s3Utils }):Buckets => {

  const { MEMORY_SIZE } = env

  function loadBucket (name) {
    if (buckets[name]) return

    const physicalId = serviceMap.Bucket[name]
    if (!physicalId) throw new Error('bucket not found')

    buckets[name] = new Bucket({
      env,
      name: physicalId,
      s3: aws.s3,
      cache: cacheConfig[name] && new Cache(cacheConfig[name]),
      logger: logger.sub(`bucket:${name}`),
      s3Utils
    })
  }

  const buckets = {} as Buckets
  Object.keys(serviceMap.Bucket).forEach(loadBucket)
  return buckets
}
