
import AWS = require('aws-sdk')
import createS3Utils = require('./s3-utils')

export class Bucket {
  public id:string // alias
  public name:string
  private utils: any
  constructor ({ name, s3 }: {
    name:string,
    s3:AWS.S3
  }) {
    if (typeof name !== 'string') {
      throw new Error('expected string "name"')
    }

    this.name = name
    this.id = name // alias
    this.utils = createS3Utils({ s3 })
  }

  public get = key => this.utils.get({ key, bucket: this.name })
  public getJSON = key => this.utils.getJSON({ key, bucket: this.name })
  public list = () => this.utils.listBucket({ bucket: this.name })
  public put = (key, value) => this.utils.put({ key, value, bucket: this.name })
  public putJSON = (key, value) => this.utils.putJSON({ key, value, bucket: this.name })
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
