import { omit } from 'lodash'
import { TYPE } from '@tradle/constants'
import Errors = require('./errors')
import Logger from './logger'
import { timeMethods, isPromise, batchify, batchProcess } from './utils'

module.exports = function createUtils ({ s3, logger }) {
  const put = async ({ key, value, bucket, contentType }: {
    key:string,
    value:any,
    bucket:string,
    contentType?:string
  }):Promise<AWS.S3.Types.PutObjectOutput> => {
    // logger.debug('putting', { key, bucket, type: value[TYPE] })
    const opts:AWS.S3.Types.PutObjectRequest = {
      Bucket: bucket,
      Key: key,
      Body: toStringOrBuf(value)
    }

    if (contentType) {
      opts.ContentType = contentType
    }

    return await s3.putObject(opts).promise()
  }

  const get = async ({ key, bucket, ...opts }: {
    key:string,
    bucket:string,
    [x:string]: any
  }):Promise<AWS.S3.Types.GetObjectOutput> => {
    const params:AWS.S3.Types.GetObjectRequest = {
      Bucket: bucket,
      Key: key,
      ...opts
    }

    try {
      const result = await s3.getObject(params).promise()
      // logger.debug('got', { key, bucket, type: result[TYPE] })
      return result
    } catch(err) {
      if (err.code === 'NoSuchKey') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
    }
  }

  const forEachItemInBucket = async ({ bucket, getBody, map, ...opts }: {
    bucket: string,
    getBody?: boolean,
    map: Function,
    [x:string]: any
  }) => {
    const params:AWS.S3.Types.ListObjectsRequest = {
      Bucket: bucket,
      ...opts
    }

    let Marker
    while (true) {
      let { NextMarker, Contents } = await s3.listObjects(params).promise()
      if (getBody) {
        await batchProcess({
          data: Contents,
          batchSize: 20,
          processOne: async (item) => {
            const withBody = await s3.getObject({ Bucket: bucket, Key: item.Key }).promise()
            let result = map({ ...item, ...withBody })
            if (isPromise(result)) await result
          }
        })
      } else {
        await Promise.all(Contents.map(async (item) => {
          const result = map(item)
          if (isPromise(result)) await result
        }))
      }

      if (!NextMarker) break

      params.Marker = NextMarker
    }
  }

  const listBucket = async ({ bucket, ...opts })
    :Promise<AWS.S3.Object[]> => {
    const all = []
    await forEachItemInBucket({
      ...opts,
      bucket,
      map: item => all.push(item)
    })

    return all
  }

  const clearBucket = async ({ bucket }) => {
    await forEachItemInBucket({
      bucket,
      map: ({ Key }) => del({ bucket, key: Key })
    })
  }

  const getCacheable = ({ key, bucket, ttl, parse, ...defaultOpts }: {
    key:string,
    bucket:string,
    ttl:number,
    parse?:(any) => any,
    [x:string]: any
  }) => {
    if (!key) throw new Error('expected "key"')
    if (!bucket) throw new Error('expected "bucket"')

    let cached
    let type
    let etag
    let cachedTime = 0
    const maybeGet = async (opts={}) => {
      let summary = { key, bucket, type }
      if (!opts.force) {
        const age = Date.now() - cachedTime
        if (etag && age < ttl) {
          logger.debug('returning cached item', {
            ...summary,
            age,
            ttl: (ttl - age)
          })

          return cached
        }
      }

      opts = {
        ...defaultOpts,
        ...omit(opts, ['force'])
      }

      if (etag) {
        opts.IfNoneMatch = etag
      }

      try {
        cached = await get({ key, bucket, ...opts })
      } catch (err) {
        if (err.code === 'NotModified') {
          logger.debug('304, returning cached item', summary)
          return cached
        }

        throw err
      }

      if (cached.ETag !== etag) {
        etag = cached.ETag
      }

      if (parse) {
        cached = parse(cached.Body)
      }

      cachedTime = Date.now()
      logger.debug('fetched and cached item', summary)

      return cached
    }

    const putAndCache = async ({ value, ...opts }) => {
      if (value == null) throw new Error('expected "value"')

      const result = await put({ bucket, key, value, ...defaultOpts, ...opts })
      cached = parse ? value : result
      cachedTime = Date.now()
      etag = result.ETag
    }

    return {
      get: maybeGet,
      put: putAndCache
    }
  }

  const putJSON = put

  const getJSON = ({ key, bucket }) => {
    return get({ key, bucket }).then(({ Body }) => JSON.parse(Body))
  }

  const head = ({ key, bucket }) => {
    return s3.headObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  const exists = ({ key, bucket }) => {
    return head({ key, bucket })
      .then(() => true, err => false)
  }

  const del = ({ key, bucket }) => {
    return s3.deleteObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  const createPresignedUrl = ({ bucket, key }) => {
    return s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: key
    })
  }

  const createBucket = ({ bucket }) => {
    return s3.createBucket({ Bucket: bucket }).promise()
  }

  const destroyBucket = ({ bucket }) => {
    return s3.deleteBucket({ Bucket: bucket }).promise()
  }

  const urlForKey = ({ bucket, key }) => {
    const { host } = s3.endpoint
    if (host.startsWith('localhost')) {
      return `http://${host}/${bucket}${key}`
    }

    return `https://${bucket}.s3.amazonaws.com/${key}`
  }

  return timeMethods({
    get,
    getJSON,
    getCacheable,
    listBucket,
    clearBucket,
    put,
    putJSON,
    head,
    del,
    exists,
    createPresignedUrl,
    createBucket,
    destroyBucket,
    urlForKey,
    forEachItemInBucket
  }, logger)
}

const toStringOrBuf = (value) => {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value
  if (!value) throw new Error('expected string, Buffer, or stringifiable object')

  return JSON.stringify(value)
}
