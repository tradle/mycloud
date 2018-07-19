import path from 'path'
import AWS from 'aws-sdk'
import _ from 'lodash'
import { S3Utils, createUtils } from './s3-utils'
import Logger from './logger'
import { cachify } from './utils'
import Errors from './errors'
import Env from './env'
import { BucketPutOpts } from './types'
import { KV } from './kv-s3'

type BucketOpts = {
  name:string
  s3:AWS.S3
  cache?:any
  logger?:Logger
  s3Utils?:S3Utils
  env?:Env
  prefix?:string
}

export class Bucket {
  public id:string // alias
  public name:string
  public baseName: string
  public prefix:string
  // public env:Env
  public logger:Logger
  public cache?: any
  public utils: S3Utils
  private opts?: BucketOpts
  constructor (opts: BucketOpts) {
    const { name, env, s3, cache, logger, s3Utils, prefix='' } = opts
    this.opts = opts
    if (typeof name !== 'string') {
      throw new Error('expected string "name"')
    }

    this.name = name
    this.id = name // alias
    this.logger = logger || new Logger(`bucket:${name}`)
    this.utils = s3Utils || createUtils({ env, s3, logger: this.logger })
    this.baseName = this.utils.getBucketBaseName(name)
    this.prefix = prefix
    if (cache) {
      this.cache = cache
      const cachified = cachify({
        get: this.getJSON,
        put: this.put,
        del: this.del,
        logger: this.logger,
        cache,
        cloneOnGet: true
      })

      this.getJSON = cachified.get
      this.putJSON = cachified.put
      this.del = cachified.del
    }
  }

  public kv(opts) {
    return new KV({ bucket: this, ...opts })
  }

  public folder = (prefix:string):Bucket => {
    return new Bucket({
      ...this.opts,
      prefix: getFolderPath(this.prefix, prefix)
    })
  }

  public get = (key: string) => this.utils.get({
    key: this._getKey(key),
    bucket: this.name
  })

  public maybeGet = (key: string) => this.get(key).catch(Errors.ignoreNotFound)

  public getJSON = (key: string) => this.get(key).then(({ Body }) => JSON.parse(Body.toString()))
  public maybeGetJSON = (key: string) => this.getJSON(key).catch(Errors.ignoreNotFound)

  public list = (opts) => this.utils.listBucket({ bucket: this.name, ...opts })
  public put = (key: string, value, opts?:Partial<BucketPutOpts>) => this.utils.put({
    key: this._getKey(key),
    value,
    bucket: this.name,
    ...opts
  })

  public putJSON = (key: string, value, opts?:Partial<BucketPutOpts>) => this.put(key, value, opts)
  public gzipAndPut = (key: string, value) => this.utils.gzipAndPut({
    key: this._getKey(key),
    value,
    bucket: this.name
  })

  public head = (key: string) => this.utils.head({ key: this._getKey(key), bucket: this.name })
  public exists = (key: string) => this.utils.exists({ key: this._getKey(key), bucket: this.name })
  public del = (key: string) => this.utils.del({ key: this._getKey(key), bucket: this.name })
  public getCacheable = opts => this.utils.getCacheable({
    ...opts,
    key: this._getKey(opts.key),
    bucket: this.name
  })

  public create = () => this.utils.createBucket({ bucket: this.name })
  public destroy = () => this.utils.destroyBucket({ bucket: this.name })
  public clear = () => this.utils.clearBucket({ bucket: this.name })
  public toString = () => this.name
  public getUrlForKey = (key:string) => this.utils.getUrlForKey({
    key: this._getKey(key),
    bucket: this.name
  })

  public forEach = (opts) => this.utils.forEachItemInBucket({ bucket: this.name, ...opts })
  public enableEncryption = (opts:any={}) => this.utils.enableEncryption({ bucket: this.name, ...opts })
  public disableEncryption = (opts:any={}) => this.utils.disableEncryption({ bucket: this.name, ...opts })
  public getEncryption = (opts:any={}) => this.utils.getEncryption({ bucket: this.name, ...opts })
  // TODO: use head (to get ETag), and compare MD5
  public putIfDifferent = async (key, value):Promise<boolean> => {
    key = this._getKey(key)
    let current
    try {
      current = await this.get(key)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }

    if (!_.isEqual(current, value)) {
      this.put(key, value)
      return true
    }

    return false
  }

  public makePublic = () => this.utils.makePublic({ bucket: this.name })
  public empty = () => this.utils.emptyBucket({ bucket: this.name })
  public copyFilesTo = ({ bucket, keys, prefix, acl }: {
    bucket: string
    keys?: string[]
    prefix?: string
    acl?: AWS.S3.ObjectCannedACL
  }) => this.utils.copyFilesBetweenBuckets({
    source: this.name,
    target: bucket,
    keys,
    prefix,
    acl,
  })

  public getRegionalBucketName = (region: string) => this.utils.getRegionalBucketName({ bucket: this.name, region })
  public getRegionalBucket = (region: string) => new Bucket({
    ...this.opts,
    name: this.getRegionalBucketName(region)
  })

  public isPublic = () => this.utils.isBucketPublic({ bucket: this.name })
  public makeKeysPublic = (keys: string[]) => this.utils.makeKeysPublic({ bucket: this.name, keys })

  // public grantReadAccess = async (opts) => this.utils.grantReadAccess({ bucket: this.name, ...opts })
  private _getKey = (key: string) => this.prefix + key
}

const getFolderPath = (parent:string, folder:string):string => {
  const fPath = path.join(parent, folder)
  return fPath.replace(/[/]+$/, '') + '/'
}
