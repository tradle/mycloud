
import AWS = require('aws-sdk')
import _ = require('lodash')
import createS3Utils from './s3-utils'
import Logger from './logger'
import { cachify } from './utils'
import Errors = require('./errors')
import Env from './env'

export class Bucket {
  public id:string // alias
  public name:string
  // public env:Env
  public logger:Logger
  public cache?: any
  private utils: any
  constructor ({ name, env, s3, cache, logger, s3Utils }: {
    name:string,
    env:Env,
    s3:AWS.S3,
    cache?:any
    logger?:Logger,
    s3Utils?:any
  }) {
    if (typeof name !== 'string') {
      throw new Error('expected string "name"')
    }

    this.name = name
    this.id = name // alias
    this.logger = logger || new Logger(`bucket:${name}`)
    this.utils = s3Utils || createS3Utils({ env, s3, logger: this.logger })
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

  public get = key => this.utils.get({ key, bucket: this.name })
  public getJSON = key => this.get(key).then(({ Body }) => JSON.parse(Body))
  public list = () => this.utils.listBucket({ bucket: this.name })
  public put = (key, value) => this.utils.put({ key, value, bucket: this.name })
  public putJSON = (key, value) => this.put(key, value)
  public gzipAndPut = (key, value) => this.utils.gzipAndPut({
    key,
    value,
    bucket: this.name
  })

  public head = key => this.utils.head({ key, bucket: this.name })
  public exists = key => this.utils.exists({ key, bucket: this.name })
  public del = key => this.utils.del({ key, bucket: this.name })
  public getCacheable = opts => this.utils.getCacheable({ ...opts, bucket: this.name })
  public create = () => this.utils.createBucket({ bucket: this.name })
  public destroy = () => this.utils.destroyBucket({ bucket: this.name })
  public clear = () => this.utils.clearBucket({ bucket: this.name })
  public toString = () => this.name
  public urlForKey = (key:string) => this.utils.urlForKey({ key, bucket: this.name })
  public forEach = (opts) => this.utils.forEachItemInBucket({ bucket: this.name, ...opts })
  public putIfDifferent = async (key, value):Promise<boolean> => {
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
}
