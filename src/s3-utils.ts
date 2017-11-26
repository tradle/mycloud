import omit = require('object.omit')
import Errors = require('./errors')
import Logger from './logger'

module.exports = function createUtils (aws) {
  const logger = new Logger('s3-utils')
  const put = async ({ key, value, bucket, contentType }: {
    key:string,
    value:any,
    bucket:string,
    contentType?:string
  }):Promise<AWS.S3.Types.PutObjectOutput> => {
    // debug(`putting ${key} -> ${value} into Bucket ${bucket}`)
    const opts:AWS.S3.Types.PutObjectRequest = {
      Bucket: bucket,
      Key: key,
      Body: toStringOrBuf(value)
    }

    if (contentType) {
      opts.ContentType = contentType
    }

    return await aws.s3.putObject(opts).promise()
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
      return await aws.s3.getObject(params).promise()
    } catch(err) {
      if (err.code === 'NoSuchKey') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
    }
  }

  const listBucket = async ({ bucket, ...opts })
    :Promise<AWS.S3.Types.ListObjectsOutput> => {
    const params:AWS.S3.Types.ListObjectsRequest = {
      Bucket: bucket,
      ...opts
    }

    return await aws.s3.listObjects(params).promise()
  }

  const clearBucket = async ({ bucket }) => {
    const { Contents } = await listBucket({ bucket })
    await Promise.all(Contents.map(({ Key }) => del({ bucket, key: Key })))
  }

  const getCacheable = ({ key, bucket, ttl, parse, ...defaultOpts }: {
    key:string,
    bucket:string,
    ttl:number,
    parse?:(any) => any,
    [x:string]: any
  }) => {
    let cached
    let etag
    let cachedTime
    const maybeGet = async (opts={}) => {
      if (!opts.force) {
        const age = Date.now() - cachedTime
        if (etag && age < ttl) {
          logger.debug(`returning cached item for key ${key}, ttl: ${(ttl - age)}`)
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
          logger.debug(`304, returning cached item for key ${key}, ETag ${etag}`)
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
      logger.debug(`fetched and cached item for key ${key}, ETag ${etag}`)
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
    return aws.s3.headObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  const exists = ({ key, bucket }) => {
    return head({ key, bucket })
      .then(() => true, err => false)
  }

  const del = ({ key, bucket }) => {
    return aws.s3.deleteObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  const createPresignedUrl = ({ bucket, key }) => {
    return aws.s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: key
    })
  }

  const createBucket = ({ bucket }) => {
    return aws.s3.createBucket({ Bucket: bucket }).promise()
  }

  const destroyBucket = ({ bucket }) => {
    return aws.s3.deleteBucket({ Bucket: bucket }).promise()
  }

  const urlForKey = ({ bucket, key }) => {
    const { host } = aws.s3.endpoint
    if (host.startsWith('localhost')) {
      return `http://${host}/${bucket}${key}`
    }

    return `https://${bucket}.s3.amazonaws.com/${key}`
  }

  return {
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
    urlForKey
  }
}

const toStringOrBuf = (value) => {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value
  if (!value) throw new Error('expected string, Buffer, or stringifiable object')

  return JSON.stringify(value)
}
