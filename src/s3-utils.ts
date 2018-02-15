import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import Errors = require('./errors')
import Env from './env'
import Logger from './logger'
import { S3 } from 'aws-sdk'
import { timeMethods, isPromise, batchProcess, gzip, gunzip, isPrivateHost } from './utils'

export type PutOpts = {
  key:string
  value:any
  bucket:string
  headers?:any
  publicRead?: boolean
}

export default class S3Utils {
  public s3: S3
  public logger: Logger
  public env: Env
  constructor({ s3, logger, env }: {
    s3: S3,
    logger: Logger,
    env?: Env
  }) {
    this.s3 = s3
    this.logger = logger
    this.env = env
  }

  public put = async ({ key, value, bucket, headers = {}, publicRead }: PutOpts): Promise<S3.Types.PutObjectOutput> => {
    // logger.debug('putting', { key, bucket, type: value[TYPE] })
    const opts: S3.Types.PutObjectRequest = {
      ...headers,
      Bucket: bucket,
      Key: key,
      Body: toStringOrBuf(value)
    }

    if (publicRead) opts.ACL = 'public-read'

    return await this.s3.putObject(opts).promise()
  }

  public gzipAndPut = async (opts) => {
    const { value, headers = {} } = opts
    const compressed = await gzip(toStringOrBuf(value))
    return await this.put({
      ...opts,
      value: compressed,
      headers: {
        ...headers,
        ContentEncoding: 'gzip'
      }
    })
  }

  public get = async ({ key, bucket, ...opts }: {
    key: string,
    bucket: string,
    [x: string]: any
  }): Promise<S3.Types.GetObjectOutput> => {
    const params: S3.Types.GetObjectRequest = {
      Bucket: bucket,
      Key: key,
      ...opts
    }

    try {
      const result = await this.s3.getObject(params).promise()
      // logger.debug('got', { key, bucket, type: result[TYPE] })
      if (result.ContentEncoding === 'gzip') {
        // localstack gunzips but leaves ContentEncoding header
        if (!(this.env && this.env.TESTING)) {
          result.Body = await gunzip(result.Body)
          delete result.ContentEncoding
        }
      }

      return result
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
    }
  }

  public forEachItemInBucket = async ({ bucket, getBody, map, ...opts }: {
    bucket: string,
    getBody?: boolean,
    map: Function,
    [x: string]: any
  }) => {
    const params: S3.Types.ListObjectsRequest = {
      Bucket: bucket,
      ...opts
    }

    let Marker
    while (true) {
      let { NextMarker, Contents } = await this.s3.listObjects(params).promise()
      if (getBody) {
        await batchProcess({
          data: Contents,
          batchSize: 20,
          processOne: async (item) => {
            const withBody = await this.s3.getObject({ Bucket: bucket, Key: item.Key }).promise()
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

  public listBucket = async ({ bucket, ...opts })
    : Promise<S3.Object[]> => {
    const all = []
    await this.forEachItemInBucket({
      ...opts,
      bucket,
      map: item => all.push(item)
    })

    return all
  }

  public clearBucket = async ({ bucket }) => {
    await this.forEachItemInBucket({
      bucket,
      map: ({ Key }) => this.del({ bucket, key: Key })
    })
  }

  public getCacheable = ({ key, bucket, ttl, parse, ...defaultOpts }: {
    key: string,
    bucket: string,
    ttl: number,
    parse?: (any) => any,
    [x: string]: any
  }) => {
    if (!key) throw new Error('expected "key"')
    if (!bucket) throw new Error('expected "bucket"')
    if (!ttl) throw new Error('expected "ttl"')

    let cached
    let type
    let etag
    let cachedTime = 0
    const invalidateCache = () => {
      cached = undefined
      type = undefined
      etag = undefined
      cachedTime = 0
    }

    const maybeGet = async (opts: any = {}) => {
      let summary = { key, bucket, type }
      if (!opts.force) {
        const age = Date.now() - cachedTime
        if (etag && age < ttl) {
          this.logger.debug('returning cached item', {
            ...summary,
            age,
            ttl: (ttl - age)
          })

          return cached
        }
      }

      opts = {
        ...defaultOpts,
        ..._.omit(opts, ['force'])
      }

      if (etag) {
        opts.IfNoneMatch = etag
      }

      try {
        cached = await this.get({ key, bucket, ...opts })
      } catch (err) {
        if (err.code === 'NotModified') {
          this.logger.debug('304, returning cached item', summary)
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
      this.logger.debug('fetched and cached item', summary)

      return cached
    }

    const putAndCache = async ({ value, ...opts }) => {
      if (value == null) throw new Error('expected "value"')

      const result = await this.put({ bucket, key, value, ...defaultOpts, ...opts })
      cached = parse ? value : {
        Body: JSON.stringify(value),
        ...result
      }

      cachedTime = Date.now()
      etag = result.ETag
    }

    return {
      get: maybeGet,
      put: putAndCache,
      invalidateCache
    }
  }

  public putJSON = this.put

  public getJSON = ({ key, bucket }) => {
    return this.get({ key, bucket }).then(({ Body }) => JSON.parse(Body.toString()))
  }

  public head = async ({ key, bucket }) => {
    try {
      await this.s3.headObject({
        Bucket: bucket,
        Key: key
      }).promise()
    } catch (err) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }
    }
  }

  public exists = ({ key, bucket }) => {
    return this.head({ key, bucket })
      .then(() => true, err => false)
  }

  public del = ({ key, bucket }) => {
    return this.s3.deleteObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  public createPresignedUrl = ({ bucket, key }) => {
    return this.s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: key
    })
  }

  public createBucket = ({ bucket }) => {
    return this.s3.createBucket({ Bucket: bucket }).promise()
  }

  public destroyBucket = ({ bucket }) => {
    return this.s3.deleteBucket({ Bucket: bucket }).promise()
  }

  public getUrlForKey = ({ bucket, key }) => {
    const { host } = this.s3.endpoint
    if (isPrivateHost(host)) {
      return `http://${host}/${bucket}${key}`
    }

    return `https://${bucket}.s3.amazonaws.com/${key}`
  }

  public disableEncryption = async ({ bucket }) => {
    this.logger.info(`disabling server-side encryption from bucket ${bucket}`)
    await this.s3.deleteBucketEncryption({ Bucket: bucket }).promise()
  }

  public enableEncryption = async ({ bucket, kmsKeyId }: {
    bucket: string,
    kmsKeyId?: string
  }) => {
    this.logger.info(`enabling server-side encryption for bucket ${bucket}`)
    const params = toEncryptionParams({ bucket, kmsKeyId })
    await this.s3.putBucketEncryption(params).promise()
  }

  public getEncryption = async ({ bucket }) => {
    return await this.s3.getBucketEncryption({ Bucket: bucket }).promise()
  }

  public getLatest = (list:S3.Object[]):S3.Object => {
    let max = 0
    let latest
    for (let metadata of list) {
      let date = new Date(metadata.LastModified).getTime()
      if (date > max) latest = metadata
    }

    return latest
  }

  public makePublic = async (bucket: string) => {
    this.logger.warn(`making bucket public: ${bucket}`)
    await this.s3.putBucketPolicy({
      Bucket: bucket,
      Policy: `{
        "Version": "2012-10-17",
        "Statement": [{
          "Sid": "MakeItPublic",
          "Effect": "Allow",
          "Principal": "*",
          "Action": "s3:GetObject",
          "Resource": "arn:aws:s3:::${bucket}/*"
        }]
      }`
    }).promise()
  }
}

export { S3Utils }
export const createUtils = opts => new S3Utils(opts)

const toStringOrBuf = (value) => {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value
  if (!value) throw new Error('expected string, Buffer, or stringifiable object')

  return JSON.stringify(value)
}

const toEncryptionParams = ({ bucket, kmsKeyId }):S3.PutBucketEncryptionRequest => {
  const ApplyServerSideEncryptionByDefault:S3.ServerSideEncryptionByDefault = {
    SSEAlgorithm: kmsKeyId ? 'aws:kms' : 'AES256'
  }

  if (kmsKeyId) {
    ApplyServerSideEncryptionByDefault.KMSMasterKeyID = kmsKeyId
  }

  return {
    Bucket: bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault
        }
      ]
    }
  }
}
