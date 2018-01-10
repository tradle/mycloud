
import promisify = require('pify')
import collect = require('stream-collector')
import { aws } from './'
import { sha256 } from './crypto'
import { stableStringify } from './string-utils'
import { AwsApis } from './aws'
const promiseCollect = promisify(collect)

type Hasher = (any) => string

const defaultHasher = data => sha256(data, 'hex')

export default class ContentAddressedStore {
  private aws:AwsApis
  private bucket:any
  private hasher:Hasher
  constructor ({ aws, bucket, hasher=defaultHasher }: {
    aws: AwsApis,
    bucket: any,
    hasher: Hasher
  }) {
    this.bucket = bucket
    this.aws = aws
    this.hasher = hasher
  }

  public get = key => this.bucket.get(key)
  public put = async (data) => {
    const key = this.hasher(serialize(data))
    await this.bucket.put(key, data)
    return key
  }
}

export { ContentAddressedStore }

const serialize = data => {
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return data
  }

  return stableStringify(data)
}
