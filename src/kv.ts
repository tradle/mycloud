import { omit } from "lodash"
import { DynamoDB } from "aws-sdk"

import { TYPE } from "@tradle/constants"

import { DB, Table, UpdateableKeyValueStore } from "./types"

import Errors from "./errors"
import { ensureTimestamped } from "./utils"
import models from "./models"

const KVModel = models["tradle.POJO"]

type SetItem = string | number

type KVPair = {
  key: string
  value: any
}

export default class KV implements UpdateableKeyValueStore {
  private db: DB
  private client: DynamoDB
  private prefix: string
  private keyProperty: string
  private _table: Table
  private _tableName: string
  constructor({ db, prefix = "" }) {
    this.db = db
    this.client = db.rawClient
    this.prefix = prefix
    this.keyProperty = Object.keys(KVModel.properties)[0]
    this._table = this._getTable()
    this._tableName = this._getTableName()
  }

  public has = async (key: string): Promise<boolean> => {
    try {
      await this.get(key, {
        AttributesToGet: ["key"]
      })

      return true
    } catch (err) {
      return false
    }
  }

  public get = async (key: string, opts: any = {}): Promise<any> => {
    try {
      const result = await this.db.get(this.wrapKey(key), opts)
      return this.exportValue(result)
    } catch (err) {
      if (Errors.isNotFound(err)) {
        throw new Errors.NotFound(`${key}: ${err.message}`)
      }

      throw err
    }
  }

  public put = async (key: string, value: any): Promise<void> => {
    this._validateKV(key, value)
    await this.db.put(this._toItem(key, value))
  }

  public batchPut = async (pairs: KVPair[]): Promise<void> => {
    pairs.forEach(({ key, value }) => this._validateKV(key, value))
    const values = pairs.map(({ key, value }) => this._toItem(key, value))
    await this.db.batchPut(values)
  }

  public del = async (key): Promise<void> => {
    await this.db.del(this.wrapKey(key))
  }

  public update = async (key: string, opts: any): Promise<any> => {
    const result = await this.db.update(ensureTimestamped(this.wrapKey(key)), opts)
    return result && this.exportValue(result)
  }

  public sub = (prefix = ""): KV => {
    return new KV({
      db: this.db,
      prefix: this.prefix + prefix
    })
  }

  // public updateMap = async ({ key, set, unset }: {
  //   key: string
  //   set?: PathAndValuePair[]
  //   unset?: PropPath[]
  // }) => {
  //   const attributes = new ExpressionAttributes()
  //   const updateExpr = new UpdateExpression()
  //   if (set) {
  //     set.forEach(([path, value]) => {
  //       updateExpr.set(toAttributePath(path), value)
  //     })
  //   }

  //   if (unset) {
  //     unset.forEach(path => updateExpr.remove(toAttributePath(path)))
  //   }

  //   const table = await this._promiseTable
  //   const updateExprStr = updateExpr.serialize(attributes)
  //   const updateParams:Partial<DynamoDB.DocumentClient.UpdateItemInput> = {
  //     // Key: this.wrapKey(key, true),
  //     UpdateExpression: updateExprStr,
  //     ExpressionAttributeNames: attributes.names,
  //     ExpressionAttributeValues: unmarshallDBItem(attributes.values)
  //   }

  //   await table.update(this.wrapKey(key), updateParams)
  // }

  // public updateSet = async ({ key, property, add, remove }: {
  //   key: string,
  //   property: string,
  //   add?: SetItem[]
  //   remove?: SetItem[]
  // }) => {
  //   if (add && remove) {
  //     throw new Errors.InvalidInput(`cannot both "add" and "remove" in one operation`)
  //   }

  //   const attributes = new ExpressionAttributes()
  //   const expr = new UpdateExpression()
  //   if (add) {
  //     expr.add(property, new Set(add))
  //   }

  //   if (remove) {
  //     expr.delete(property, new Set(remove))
  //   }

  //   const updateExpr = expr.serialize(attributes)
  //   const params:Partial<DynamoDB.DocumentClient.UpdateItemInput> = {
  //     // Key: this.wrapKey(key, true),
  //     UpdateExpression: updateExpr,
  //     ExpressionAttributeNames: attributes.names,
  //     ExpressionAttributeValues: unmarshallDBItem(attributes.values)
  //   }

  //   const table = await this._promiseTable
  //   await table.update(this.wrapKey(key), params)
  // }

  private getKey = (key: string) => {
    return this.prefix + key
  }

  private wrapKey = (key: string, noType?: boolean) => {
    const wrapper = {
      [this.keyProperty]: this.prefix + key
    }

    if (!noType) {
      wrapper[TYPE] = KVModel.id
    }

    return wrapper
  }

  private exportValue = value => omit(value, [this.keyProperty, TYPE])

  private _validateKV = (key: string, value: any) => {
    if (Object.prototype.toString.call(value) !== "[object Object]") {
      throw new Errors.InvalidInput(
        '"value" must be a plain javascript object (no arrays, strings, etc.)'
      )
    }

    if (this.keyProperty in value && key !== value[this.keyProperty]) {
      throw new Errors.InvalidInput(`expected value['${this.keyProperty}'] to equal: ${key}`)
    }
  }

  private _toItem = (key, value) => ({
    ...this.wrapKey(key),
    ...ensureTimestamped(value)
  })

  private _getTable = () => {
    return this.db.getTableForModel(KVModel)
  }

  private _getTableName = () => {
    const table = this._getTable()
    return table.name
  }
}

export { KV }
