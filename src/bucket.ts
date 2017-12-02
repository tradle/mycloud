
import AWS = require('aws-sdk')
import createS3Utils = require('./s3-utils')
import Logger from './logger'
import { cachify } from './utils'

export class Bucket {
  public id:string // alias
  public name:string
  public logger:Logger
  public cache?: any
  private utils: any
  constructor ({ name, s3, cache, logger }: {
    name:string,
    s3:AWS.S3,
    cache?:any
    logger?:Logger
  }) {
    if (typeof name !== 'string') {
      throw new Error('expected string "name"')
    }

    this.name = name
    this.id = name // alias
    this.utils = createS3Utils({ s3 })
    this.logger = logger || new Logger(`bucket:${name}`)
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
  public head = key => this.utils.head({ key, bucket: this.name })
  public exists = key => this.utils.exists({ key, bucket: this.name })
  public del = key => this.utils.del({ key, bucket: this.name })
  public getCacheable = opts => this.utils.getCacheable({ ...opts, bucket: this.name })
  public create = () => this.utils.createBucket({ bucket: this.name })
  public destroy = () => this.utils.destroyBucket({ bucket: this.name })
  public clear = () => this.utils.clearBucket({ bucket: this.name })
  public toString = () => this.name
  public urlForKey = (key:string) => this.utils.urlForKey({ key, bucket: this.name })
}
