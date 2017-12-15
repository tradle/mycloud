
import { Bucket } from './bucket'

const identity = a => a

export class CacheableBucketItem {
  private value: any
  private parse: Function
  constructor(opts: {
    bucket:Bucket,
    key:string,
    ttl?: number
    parse?: Function
  }) {
    this.value = opts.bucket.getCacheable(opts)
    this.parse = identity
  }

  public get = async (opts?) => {
    const value = await this.value.get(opts)
    return this.parse(value)
  }

  public put = async (value:any, opts={}) => {
    return await this.value.put({ value, ...opts })
  }
}
