import { omit } from 'lodash'
import { Bucket } from './bucket'
import { DatedValue } from './types'

const identity = a => a

export class CacheableBucketItem {
  private bucket:Bucket
  private key: string
  private value: any
  private parse: Function
  private lastModified?: number
  constructor(opts: {
    bucket:Bucket,
    key:string,
    ttl?: number
    parse?: Function
  }) {
    this.bucket = opts.bucket
    this.key = opts.key
    this.value = opts.bucket.getCacheable(omit(opts, ['parse']))
    this.parse = opts.parse || identity
    this.lastModified = null
  }

  public getDatedValue = async ():Promise<DatedValue> => {
    const value = await this.get()
    return {
      value,
      lastModified: this.lastModified
    }
  }

  public get = async (opts?):Promise<any> => {
    const { Body, LastModified } = await this.value.get(opts)
    this.lastModified = new Date(LastModified).getTime()
    return this.parse(Body)
  }

  public put = async (value:any, opts={}) => {
    return await this.value.put({ value, ...opts })
  }

  public putIfDifferent = async (value:any, opts={}) => {
    const updated = await this.bucket.putIfDifferent(this.key, value)
    if (updated) this.value.invalidateCache()
    return updated
  }
}
