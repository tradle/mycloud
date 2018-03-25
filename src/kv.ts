import { omit } from 'lodash'
import {
  getTableHashKey
} from './db-utils'

import {
  IKeyValueStore
} from './types'

import Errors from './errors'

export default class KV implements IKeyValueStore {
  private table:any
  private prefix:string
  private keyProperty:string
  constructor ({ table, prefix='' }) {
    this.table = table
    this.prefix = prefix
    this.keyProperty = getTableHashKey(table)
  }

  public exists = async (key:string):Promise<boolean> => {
    try {
      await this.get(key, {
        AttributesToGet: ['key']
      })

      return true
    } catch (err) {
      return false
    }
  }

  public get = async (key:string, opts:any={}):Promise<any> => {
    try {
      const result = await this.table.get({
        Key: this.wrapKey(key),
        ...opts
      })

      return this.exportValue(result)
    } catch (err) {
      if (err.code === 'ResourceNotFoundException' || err.name === 'NotFound') {
        err.name = 'NotFound'
        err.notFound = true
      }

      throw err
    }
  }

  public put = async (key:string, value:any):Promise<void> => {
    if (this.keyProperty in value && key !== value[this.keyProperty]) {
      throw new Errors.InvalidInput(`expected value['${this.keyProperty}'] to equal: ${key}`)
    }

    await this.table.put({
      Item: {
        [this.keyProperty]: this.getKey(key),
        ...value
      }
    })
  }

  public del = async (key):Promise<void> => {
    await this.table.del({
      Key: this.wrapKey(key)
    })
  }

  public update = async (key:string, opts:any):Promise<any> => {
    const result = await this.table.update({
      Key: this.wrapKey(key),
      ...opts
    })

    return result && this.exportValue(result)
  }

  public sub = (prefix=''):KV => {
    return new KV({
      table: this.table,
      prefix: this.prefix + prefix
    })
  }

  private getKey = (key:string) => {
    return this.prefix + key
  }

  private wrapKey = (key:string) => {
    return {
      [this.keyProperty]: this.prefix + key
    }
  }

  private exportValue = value => omit(value, this.keyProperty)
}

export { KV }
