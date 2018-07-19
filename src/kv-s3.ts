import {
  IKeyValueStore,
  Bucket,
} from './types'

export class KV implements IKeyValueStore {
  private bucket: Bucket
  private compress: boolean
  constructor({ bucket, compress }: {
    bucket: Bucket
    compress?: boolean
  }) {
    this.bucket = bucket
    this.compress = compress
  }

  public exists = async (key: string): Promise<boolean> => {
    return await this.bucket.exists(key)
  }

  public get = async (key: string, opts: any = {}): Promise<any> => {
    return await this.bucket.getJSON(key)
  }

  public put = async (key: string, value: any): Promise<void> => {
    if (this.compress) {
      await this.bucket.gzipAndPut(key, value)
    } else {
      await this.bucket.putJSON(key, value)
    }
  }

  public del = async (key): Promise<void> => {
    await this.bucket.del(key)
  }

  public sub = (prefix = ''): KV => {
    return new KV({
      bucket: this.bucket.withPrefix(prefix),
      compress: this.compress
    })
  }
}

export default KV
