import { EventEmitter } from 'events'
import _ from 'lodash'
import { diff } from 'just-diff'
import { cloneDeep } from 'lodash'
import { TYPE, SIG } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import Errors from '../errors'
import {
  Bot,
  Model,
  Models,
  ITradleObject,
  ResourceStub,
  Backlinks
} from '../types'

import {
  pickBacklinks,
  omitBacklinks,
  omitVirtual,
  parseStub
} from '../utils'

import { mixin as modelsMixin } from './models-mixin'

type ExportResourceInput = {
  validate?: boolean
}

export interface IDBKey {
  hashKey: string
  rangeKey?: string
}

const SET_OPTS = {
  validate: false,
  stripSig: false
}

const QUOTE = '"'


export class Resource extends EventEmitter {
  public diff: any
  public model: Model
  public models: Models
  public type: string

  private bot: Bot
  private resource: any
  private originalResource: any

  constructor({ models, model, type, resource={}, bot }: {
    models?: any
    model?: any
    type?: string
    resource?: any
    bot?: Bot
  }) {
    super()

    if (bot) {
      Object.defineProperty(this, 'models', {
        get() { return bot.models }
      })
    } else {
      this.models = models
    }

    if (!this.models) {
      throw new Errors.InvalidInput('expected "models" or "bot"')
    }

    if (!(model || type || resource[TYPE])) {
      throw new Errors.InvalidInput(`expected "model" or "type" or "resource.${TYPE}"`)
    }

    this.bot = bot
    modelsMixin(this)

    if (model) {
      if (!model.id) throw new Errors.InvalidInput('invalid "model" option')

      this.model = model
    } else {
      this.model = this.models[type || resource[TYPE]]
    }

    if (!this.model) {
      throw new Errors.InvalidInput('unable to deduce "model"')
    }

    this.type = this.model.id
    this.resource = {
      [TYPE]: resource[TYPE] || this.model.id,
      ...resource
    }

    this.originalResource = cloneDeep(this.omitBacklinks())
    this.diff = []
  }

  public get modified() {
    return this.diff.length
  }

  public get link() {
    return buildResource.link(this.resource)
  }

  public get permalink() {
    return buildResource.permalink(this.resource)
  }

  public get key() {
    return getPrimaryKey({
      model: this.model,
      resource: this.resource
    })
  }

  public get keyString() {
    return serializePrimaryKey(this.resource, this.primaryKeysSchema)
  }

  public get stub() {
    return this.key
  }

  public get props() {
    // danger!
    return this.resource
  }

  public get primaryKeysSchema() {
    return getPrimaryKeySchema(this.model)
  }

  public parseKeyString = (key: string) => parsePrimaryKeyString({ key, schema: this.primaryKeysSchema })
  public static parseKeyString = ({ key, models }: {
    key: string
    models: Models
  }) => parsePrimaryKeyString({ key, models })

  public static serializeKey = ({ key, model, models }: {
    key: any
    model?: Model
    models?: Models
  }) => {
    if (!model) {
      model = models[key[TYPE]]
    }

    return serializePrimaryKey(key, getPrimaryKeySchema(model))
  }

  public isSigned = () => !!this.resource[SIG]
  public save = async (opts?) => {
    this._ensureHaveBot()
    this._assertDiff()
    await this.bot.save(this.resource)
    this.diff = []
    this.emit('save')
    return this
  }

  public sign = async (opts?) => {
    this._ensureHaveBot()
    this._assertDiff()

    const signed = await this.bot.sign(this.toJSON(opts))
    this.bot.objects.addMetadata(signed)

    this.set(signed)
    this.emit('sign')
    return this
  }

  public signAndSave = async (opts?) => {
    this._ensureHaveBot()
    await this.sign()
    await this.save()
    return this
  }

  public get = key => this.resource[key]

  public unset = key => {
    delete this.resource[key]
    return this
  }

  public set = (...args:any[]) => {
    const { models, model } = this
    // don't validate because we might still have a partial resource
    const updated = buildResource({ models, model })
      .set(...args)
      .toJSON(SET_OPTS)

    _.extend(this.resource, updated)
    if (!updated[SIG]) {
      // any modifications invalidate the current sig
      this.unset(SIG)
    }

    this.diff = diff(this.omitBacklinks(), this.originalResource)
    return this
  }

  public setVirtual = (...args:any[]) => {
    const updated = buildResource(this)
      .setVirtual(...args)
      .toJSON(SET_OPTS)

    _.extend(this.resource, updated)
    return this
  }

  public toJSON = (opts:ExportResourceInput={}) => {
    const { models, model, resource } = this
    if (opts.validate === false) {
      return cloneDeep(resource)
    }

    return cloneDeep(resource)
  }

  public validate = () => validateResource.resource({
    models: this.models,
    resource: this.resource
  })

  public getForwardLinks = (backlinks?: Backlinks) => {
    if (!backlinks) backlinks = this.bot.backlinks

    return backlinks.getForwardLinks(this.resource)
  }

  public getBacklinks = (resource=this.resource) => pickBacklinks({
    model: this.model,
    resource
  })

  public updateBacklink = ({ backlink, stub }: {
    backlink: string
    stub: any
  }) => {
    const stable = toStableStub(stub)
    const arr = this.get(backlink) || []
    let idx = arr.findIndex(stub => _.isEqual(toStableStub(stub), stable))
    if (idx === -1) idx = arr.length

    arr.push(stub)
    this.set(backlink, arr)
    return this
  }

  private _assertDiff = () => {
    if (!this.diff.length) {
      throw new Error('no changes to save!')
    }
  }

  private _ensureHaveBot = () => {
    if (!this.bot) {
      throw new Errors.InvalidInput(`provide "bot" in constructor if you want to run this operation'`)
    }
  }

  private omitBacklinks = (resource=this.resource) => omitBacklinks({
    model: this.model,
    resource
  })
}

export const defaultPrimaryKeysSchema = { hashKey: '_permalink' }

export const getPrimaryKeySchema = model => {
  return normalizeIndexedProperty(model.primaryKeys || defaultPrimaryKeysSchema)
}

export const normalizeIndexedProperty = schema => {
  if (Array.isArray(schema)) {
    return { hashKey: schema[0], rangeKey: schema[1] }
  }

  if (typeof schema === 'string') {
    return { hashKey: schema }
  }

  return schema
}

export const getPrimaryKey = ({ model, resource }) => {
  return _.pick(resource, _.values(getPrimaryKeySchema(model)).concat(TYPE))
}

export const getKeyProps = (schema: IDBKey) => {
  const keys = [TYPE, schema.hashKey]
  if (schema.rangeKey) {
    keys.push(schema.rangeKey)
  }

  return keys
}

export const getKey = (resource: any, schema: IDBKey) => {
  return _.pick(resource, getKeyProps(schema))
}

export const serializePrimaryKey = (resource: any, schema: IDBKey):string => {
  const keys = getKeyProps(schema)
  const values = keys.map(prop => {
    const v = _.get(resource, prop)
    if (!v) throw new Error(`missing required property ${prop}`)

    return JSON.stringify(String(v)).slice(1, -1)
  })

  return values.join(QUOTE)
}

export const unserializePrimaryKey = (key: string):string[] => {
  // const keys = getKeyProps(schema)
  // add start end quotes, to get markers for start, end
  key = `"${key}"`

  const markers = []
  let i = key.length
  while (i--) {
    let char = key[i]
    if (char === '"' && key[i - 1] !== '\\') {
      markers.unshift(i)
    }
  }

  let values = []
  for (let j = 1; j < markers.length; j++) {
    // cut off quotes
    let start = markers[j - 1] + 1
    values.push(key.slice(start, markers[j]))
  }

  return values.map(v => JSON.parse(`${QUOTE}${v}${QUOTE}`))
}

export const parsePrimaryKeyString = ({ key, schema, models, model }: {
  key: string
  schema?: IDBKey
  model?: Model
  models?: Models
}): any => {
  const values = unserializePrimaryKey(key)
  if (!schema) {
    schema = getPrimaryKeySchema(model || models[values[0]])
  }

  return _.zipObject(getKeyProps(schema), values)
}

export const toStableStub = stub => _.omit(stub, ['title', 'id', '_link'])
