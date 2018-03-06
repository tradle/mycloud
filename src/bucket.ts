import path from 'path'
import AWS from 'aws-sdk'
import _ from 'lodash'
import { S3Utils, createUtils, PutOpts } from './s3-utils'
import Logger from './logger'
import { cachify } from './utils'
import Errors from './errors'
import Env from './env'

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
    this.prefix = prefix
    if (cache) {
      this.cache = cache
      const cachified = cachify({
        get: this.getJSON,
        put: this.put,
        del: this.del,
        logger: this.logger,
        cache
      })

      this.getJSON = cachified.get
      this.putJSON = cachified.put
      this.del = cachified.del
    }
  }

  public folder = (prefix:string):Bucket => {
    return new Bucket({
      ...this.opts,
      prefix: getFolderPath(this.prefix, prefix)
    })
  }

  public get = key => this.utils.get({
    key: this._getKey(key),
    bucket: this.name
  })

  public maybeGet = key => this.get(key).catch(Errors.ignoreNotFound)

  public getJSON = key => this.get(key).then(({ Body }) => JSON.parse(Body.toString()))
  public maybeGetJSON = key => this.getJSON(key).catch(Errors.ignoreNotFound)

  public list = (opts) => this.utils.listBucket({ bucket: this.name, ...opts })
  public put = (key, value, opts?:Partial<PutOpts>) => this.utils.put({
    key: this._getKey(key),
    value,
    bucket: this.name,
    ...opts
  })

  public putJSON = (key, value, opts?:Partial<PutOpts>) => this.put(key, value, opts)
  public gzipAndPut = (key, value) => this.utils.gzipAndPut({
    key: this._getKey(key),
    value,
    bucket: this.name
  })

  public head = key => this.utils.head({ key: this._getKey(key), bucket: this.name })
  public exists = key => this.utils.exists({ key: this._getKey(key), bucket: this.name })
  public del = key => this.utils.del({ key: this._getKey(key), bucket: this.name })
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
      Errors.ignore(err, Errors.NotFound)
    }

    if (!_.isEqual(current, value)) {
      this.put(key, value)
      return true
    }

    return false
  }

  public makePublic = () => this.utils.makePublic({ bucket: this.name })
  public empty = () => this.utils.emptyBucket({ bucket: this.name })
  private _getKey = key => this.prefix + key
}

const getFolderPath = (parent:string, folder:string):string => {
  const fPath = path.join(parent, folder)
  return fPath.replace(/[/]+$/, '') + '/'
}
