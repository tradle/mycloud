
import promisify = require('pify')
import { sha256 } from './crypto'
import { stableStringify } from './string-utils'
import { Bucket } from './bucket'

type Hasher = (any) => string

const defaultHasher = data => sha256(data, 'hex')

export default class ContentAddressedStore {
  private bucket:Bucket
  private hasher:Hasher
  constructor ({ bucket, hasher=defaultHasher }: {
    bucket: any,
    hasher: Hasher
  }) {
    this.bucket = bucket
    this.hasher = hasher
  }

  public get = key => this.bucket.get(key)
  public getJSON = key => this.bucket.getJSON(key)
  public put = async (data) => {
    const key = this.getKey(data)
    await this.bucket.put(key, data)
    return key
  }

  public del = key => this.bucket.del(key)
  public getKey = data => this.hasher(serialize(data))
}

export { ContentAddressedStore }

const serialize = data => {
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return data
  }

  return stableStringify(data)
}
