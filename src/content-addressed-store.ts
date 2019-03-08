import { sha256 } from './crypto'
import { stableStringify } from './string-utils'
import { KeyValueStore } from './types'

type Hasher = (any) => string

const defaultHasher = data => sha256(data, 'hex')
const sha256AndTrunc = (data, length) => sha256(data, 'hex').slice(0, length)

export const Hashers = {
  default: defaultHasher,
  sha256: defaultHasher,
  sha256Head: data => defaultHasher(data).slice(0, 7),
  sha256TruncatedTo: (length: number) => data => sha256AndTrunc(data, length)
}

export interface ContentAddressedStoreOpts {
  store: KeyValueStore
  hasher?: Hasher
}
export class ContentAddressedStore {
  private store: KeyValueStore
  private hasher: Hasher
  constructor({ store, hasher = defaultHasher }: ContentAddressedStoreOpts) {
    this.store = store
    this.hasher = hasher
  }

  public get = key => this.store.get(key)
  public put = async data => {
    const key = this.getKey(data)
    await this.store.put(key, data)
    return key
  }

  public del = key => this.store.del(key)
  public getKey = data => this.hasher(serialize(data))
}

export const createContentAddressedStore = (opts: ContentAddressedStoreOpts) =>
  new ContentAddressedStore(opts)

const serialize = data => {
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return data
  }

  return stableStringify(data)
}
