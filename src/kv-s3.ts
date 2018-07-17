import {
  IKeyValueStore,
  Bucket,
} from './types'

export class KV implements IKeyValueStore {
  constructor(private bucket: Bucket) { }

  public exists = async (key: string): Promise<boolean> => {
    return await this.bucket.exists(key)
  }

  public get = async (key: string, opts: any = {}): Promise<any> => {
    return await this.bucket.getJSON(key)
  }

  public put = async (key: string, value: any): Promise<void> => {
    await this.bucket.putJSON(key, value)
  }

  public del = async (key): Promise<void> => {
    await this.bucket.del(key)
  }

  public sub = (prefix = ''): KV => {
    return new KV(this.bucket.folder(prefix))
  }
}

export default KV
