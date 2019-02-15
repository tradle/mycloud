import Errors from "./errors"
import { KeyValueStoreExtended, KV } from "./types"

export default class KeyValueMem implements KeyValueStoreExtended {
  private store: any
  constructor() {
    this.store = {}
  }

  public has = async (key: string): Promise<boolean> => {
    return key in this.store
  }

  public get = async (key: string, opts: any = {}) => {
    if (key in this.store) return this.store[key]

    throw new Errors.NotFound(key)
  }

  public put = async (key: string, value) => {
    this.store[key] = value
  }

  public del = async key => {
    delete this.store[key]
  }

  public sub = () => {
    throw new Errors.Unsupported("KeyValueMem.sub")
  }
}

export { KeyValueMem }
