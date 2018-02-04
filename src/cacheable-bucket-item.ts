import _ = require('lodash')
import { Bucket, DatedValue } from './types'

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
    this.value = opts.bucket.getCacheable(_.omit(opts, ['parse']))
    this.parse = opts.parse || _.identity
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
    const result = await this.value.get(opts)
    const { Body, LastModified } = result
    this.lastModified = new Date(LastModified).getTime()
    return this.parse(Body)
  }

  public put = async (value:any, opts={}) => {
    return await this.value.put({ value, ...opts })
  }

  // public gzipAndPut = async (value:any, opts) => {
  //   return await this.value.gzipAndPut
  // }

  public putIfDifferent = async (value:any, opts={}) => {
    const updated = await this.bucket.putIfDifferent(this.key, value)
    if (updated) this.value.invalidateCache()
    return updated
  }
}
