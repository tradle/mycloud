const parseUrl = require('url').parse
const debug = require('debug')('tradle:sls:s3-utils')
const { logify, clone } = require('./utils')
const Errors = require('./errors')

module.exports = function createUtils (aws) {

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
    const maybeGet = async (opts) => {
      if (typeof opts === 'string') {
        opts = { key: opts }
      }

      if (etag && Date.now() - cachedTime < ttl) {
        return cached
      }

      opts = { ...defaultOpts, ...opts }
      if (etag) {
        opts.IfNoneMatch = etag
      }

      cached = yield get({ key, bucket, ...opts })
      if (cached.ETag !== etag) {
        etag = cached.ETag
      }

      if (parse) {
        cached = parse(cached.Body)
      }

      cachedTime = Date.now()
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
    put,
    putJSON,
    head,
    del,
    exists,
    createPresignedUrl,
    createBucket,
    urlForKey
  }
}

const toStringOrBuf = (value) => {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value
  if (!value) throw new Error('expected string, Buffer, or stringifiable object')

  return JSON.stringify(value)
}
