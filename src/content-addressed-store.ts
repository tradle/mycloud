import { sha256 } from "./crypto"
import { stableStringify } from "./string-utils"
import { Bucket } from "./types"

type Hasher = (any) => string

const defaultHasher = data => sha256(data, "hex")
const sha256AndTrunc = (data, length) => sha256(data, "hex").slice(0, length)

export const Hashers = {
  default: defaultHasher,
  sha256: defaultHasher,
  sha256Head: data => defaultHasher(data).slice(0, 7),
  sha256TruncatedTo: (length: number) => data => sha256AndTrunc(data, length)
}

export default class ContentAddressedStore {
  private bucket: Bucket
  private hasher: Hasher
  constructor({ bucket, hasher = defaultHasher }: { bucket: any; hasher?: Hasher }) {
    this.bucket = bucket
    this.hasher = hasher
  }

  public get = key => this.bucket.get(key)
  public getJSON = key => this.bucket.getJSON(key)
  public put = async data => {
    const key = this.getKey(data)
    await this.bucket.put(key, data)
    return key
  }

  public del = key => this.bucket.del(key)
  public getKey = data => this.hasher(serialize(data))
}

export { ContentAddressedStore }

const serialize = data => {
  if (typeof data === "string" || Buffer.isBuffer(data)) {
    return data
  }

  return stableStringify(data)
}
