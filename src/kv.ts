import { DynamoDB } from 'aws-sdk'
import {
  AttributePath,
  PathElement,
  UpdateExpression,
  ConditionExpression,
  ExpressionAttributes
} from '@aws/dynamodb-expressions'

import { omit, intersection } from 'lodash'
import {
  getTableHashKey,
  unmarshallDBItem,
  marshallDBItem
} from './db-utils'

import {
  IKeyValueStore
} from './types'

import Errors from './errors'
import { toPathValuePairs } from './utils'

type SetItem = string | number

export type PropPath = string|string[]
export type PathAndValuePair = [PropPath, any]

const toAttributePath = (path: PropPath) => {
  const parts = [].concat(path).map(name => ({
    type: 'AttributeName',
    name
  })) as PathElement[]

  return new AttributePath(parts)
}

type KVPair = {
  key: string
  value: any
}

export default class KV implements IKeyValueStore {
  private table:any
  private tableName: string
  private client: DynamoDB
  private prefix:string
  private keyProperty:string
  constructor ({ table, prefix='' }) {
    this.table = table
    this.tableName = table.name
    this.client = table.rawClient
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
    this._validateKV(key, value)
    await this.table.put({
      Item: {
        [this.keyProperty]: this.getKey(key),
        ...value
      }
    })
  }

  public batchPut = async (pairs:KVPair[]):Promise<void> => {
    pairs.forEach(({ key, value }) => this._validateKV(key, value))
    const values = pairs.map(({ key, value }) => ({
      [this.keyProperty]: this.getKey(key),
      ...value
    }))

    await this.table.batchPut(values)
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

  public updateMap = async ({ key, set, unset }: {
    key: string
    set?: PathAndValuePair[]
    unset?: PropPath[]
  }) => {
    const attributes = new ExpressionAttributes()
    const updateExpr = new UpdateExpression()
    if (set) {
      set.forEach(([path, value]) => {
        updateExpr.set(toAttributePath(path), value)
      })
    }

    if (unset) {
      unset.forEach(path => updateExpr.remove(toAttributePath(path)))
    }

    const updateExprStr = updateExpr.serialize(attributes)
    const updateParams:DynamoDB.UpdateItemInput = {
      TableName: this.tableName,
      Key: marshallDBItem(this.wrapKey(key)),
      UpdateExpression: updateExprStr,
      ExpressionAttributeNames: attributes.names,
      ExpressionAttributeValues: attributes.values
    }

    await this.client.updateItem(updateParams).promise()
  }

  public updateSet = async ({ key, property, add, remove }: {
    key: string,
    property: string,
    add?: SetItem[]
    remove?: SetItem[]
  }) => {
    if (add && remove) {
      throw new Errors.InvalidInput(`cannot both "add" and "remove" in one operation`)
    }

    const attributes = new ExpressionAttributes()
    const expr = new UpdateExpression()
    if (add) {
      expr.add(property, new Set(add))
    }

    if (remove) {
      expr.delete(property, new Set(remove))
    }

    const updateExpr = expr.serialize(attributes)
    const params:DynamoDB.UpdateItemInput = {
      TableName: this.tableName,
      Key: marshallDBItem(this.wrapKey(key)),
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: attributes.names,
      ExpressionAttributeValues: attributes.values
    }

    await this.client.updateItem(params).promise()
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

  private _validateKV = (key: string, value: any) => {
    if (this.keyProperty in value && key !== value[this.keyProperty]) {
      throw new Errors.InvalidInput(`expected value['${this.keyProperty}'] to equal: ${key}`)
    }
  }
}

export { KV }
