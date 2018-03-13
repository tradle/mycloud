import Errors from './errors'
import {
  IKeyValueStore
} from './types'

export default class KeyValueMem implements IKeyValueStore {
  private store: any
  constructor () {
    this.store = {}
  }

  public exists = async (key:string):Promise<boolean> => {
    return key in this.store
  }

  public get = async (key:string, opts:any={}) => {
    if (key in this.store) return this.store[key]

    throw new Errors.NotFound(key)
  }

  public put = async (key:string, value) => {
    this.store[key] = value
  }

  public del = async (key) => {
    delete this.store[key]
  }
}

export { KeyValueMem }
