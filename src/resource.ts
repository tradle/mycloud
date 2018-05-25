import { EventEmitter } from 'events'
import _ from 'lodash'
import { diff as getDiff } from 'just-diff'
import {
  AttributePath,
  PathElement,
  UpdateExpression,
  ConditionExpression,
  ExpressionAttributes
} from '@aws/dynamodb-expressions'
import { utils as DynamoUtils } from '@tradle/dynamodb'
import { TYPE, SIG, PREVLINK, PERMALINK, VERSION } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import validateModels from '@tradle/validate-model'
import {
  toAttributePath,
  unmarshallDBItem
} from './db-utils'

import Errors from './errors'
import { noopLogger } from './logger'
import {
  Bot,
  Model,
  Models,
  ITradleObject,
  ResourceStub,
  Backlinks,
  IBacklinkItem,
  Diff,
  Logger
} from './types'

import {
  pickBacklinks,
  omitBacklinks,
  omitVirtual,
  parseStub,
  getPermId,
  isPlainObject,
  getPrimaryKeySchema,
  pickNonNull
} from './utils'

const {
  isInlinedProperty,
  isEnumProperty,
  isDescendantOf,
  getAncestors
} = validateModels.utils

const {
  omitVirtualDeep
} = validateResource.utils

export interface IResourcePersister {
  models: Models
  save: (resource: Resource) => Promise<any|void>
  sign: <T>(resource: T) => Promise<T>
  logger?: Logger
}

type ExportResourceInput = {
  validate?: boolean
  virtual?: boolean
}

interface GetBacklinkPropertiesMinInput {
  // e.g.
  //   sourceModel: tradle.Verification
  //   targetModel: tradle.PhotoID
  //   linkProp: "document"
  sourceModel: Model
  targetModel: Model
  linkProp: string
}

interface GetBacklinkPropertiesInput extends GetBacklinkPropertiesMinInput {
  models: Models
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

export interface ResourceInput {
  models?: any
  model?: any
  type?: string
  resource?: any
  store?: IResourcePersister
  logger?: Logger
}

export class Resource extends EventEmitter {
  public model: Model
  public models: Models
  public type: string
  public resource: any
  public diff: Diff
  public softDiff: Diff

  private store?: IResourcePersister
  private logger: Logger
  private originalResource: any
  private _dirty: boolean

  constructor({ models, model, type, resource={}, store, logger }: ResourceInput) {
    super()

    this.logger = logger || (store && store.logger) || noopLogger

    if (store) {
      Object.defineProperty(this, 'models', {
        get() { return store.models }
      })
    } else {
      this.models = models
    }

    if (!this.models) {
      throw new Errors.InvalidInput('expected "models" or "store"')
    }

    if (!(model || type || resource[TYPE])) {
      debugger
      throw new Errors.InvalidInput(`expected "model" or "type" or "resource.${TYPE}"`)
    }

    this.store = store

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
    if (resource) {
      ensurePlainObject(resource)
    }

    this.resource = {
      [TYPE]: resource[TYPE] || this.model.id,
      ...resource
    }

    this._resetDiff()

    let diff = []
    Object.defineProperty(this, 'diff', {
      set(value) {
        diff = value
        this.softDiff = getSoftDiff(diff)
      },
      get() {
        if (this._dirty) {
          this.diff = getDiff(this.originalResource, this.omitBacklinks())
          this._dirty = false
        }

        return diff
      }
    })
  }

  // resources are "modified" until they're saved
  public isModified = () => {
    if (this.wasSigned()) return this.diff.length > 0

    return true
  }

  public get modified() {
    return this.isModified()
  }

  public get link() {
    return buildResource.links(this.resource).link
  }

  public get permalink() {
    return buildResource.links(this.resource).permalink
  }

  public get prevlink() {
    return buildResource.links(this.resource).prevlink
  }

  public get key() {
    return getPrimaryKeys(this)
  }

  public get keyString() {
    return serializePrimaryKeyWithSchema(this.resource, this.primaryKeysSchema)
  }

  public get stub() {
    return buildResource.stub({
      models: this.models,
      resource: this.resource
    })
  }

  public get stableStub() {
    return toStableStub(this.stub)
  }

  public get primaryKeysSchema() {
    return getPrimaryKeySchema(this.model)
  }

  public parseKeyString = (key: string) => parseKeyString({ key, schema: this.primaryKeysSchema })
  public isSigned = () => !!this.resource[SIG]
  public wasSigned = () => !!this.originalResource[SIG]
  public save = async (opts?) => {
    this._ensureHaveStore()
    this._assertDiff()

    await this.store.save(this)

    this._resetDiff()
    this.emit('save')
    return this
  }

  public sign = async (opts?) => {
    this._ensureHaveStore()
    if (this.isSigned()) {
      this._assertDiff()
    }

    if (this.wasSigned() && !hasVersionIncreased(this)) {
      this.logger.debug(`auto-versioning resource prior to signing`, this.stableStub)
      this.version()
    }

    if (this.isSigned()) {
      throw new Error('resource is already signed!')
      // this.unset(SIG)
    }

    const signed = await this.store.sign(this.toJSON(opts))

    this.set(signed)
    this.emit('sign')
    return this
  }

  public signAndSave = async (opts?) => {
    this._ensureHaveStore()
    await this.sign()
    await this.save()
    return this
  }

  public get = key => this.resource[key]
  public getOriginal = key => this.originalResource[key]

  public unset = (keys:string|string[]) => {
    keys = [].concat(keys)
    for (const key of keys) {
      delete this.resource[key]
    }

    this._dirty = true
    return this
  }

  public set = (...args:any[]) => {
    const { models, model } = this
    // don't validate because we might still have a partial resource
    args.forEach(arg => {
      if (typeof arg === 'object') ensurePlainObject(arg)
    })

    const updated = buildResource({ models, model })
      .set(...args)
      .toJSON(SET_OPTS)

    _.extend(this.resource, updated)
    if (!updated[SIG]) {
      // any modifications invalidate the current sig
      this.unset(SIG)
    }

    this._dirty = true
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
    const { virtual, validate } = opts
    const { models, model, resource } = this
    const exported = virtual ? _.cloneDeep(resource) : omitVirtualDeep({ models, resource })
    if (validate !== false) this.validate()

    return exported
  }

  public validate = () => validateResource.resource({
    models: this.models,
    resource: this.resource
  })

  // public getForwardLinks = (backlinks?: Backlinks) => {
  //   if (!backlinks) backlinks = this.bot.backlinks

  //   return backlinks.getForwardLinks(this.resource)
  // }

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

  public getBacklinkProperties = (opts: GetBacklinkPropertiesMinInput) => getBacklinkProperties({
    models: this.models,
    ...opts
  })

  public getForwardLinks = ():IBacklinkItem[] => {
    const { type, model, models, resource } = this
    const time = resource._time || resource.time
    if (!time) {
      const err = `missing "_time" or "time": ${JSON.stringify(resource)}`
      if (this.logger) this.logger.warn(err)
      else console.warn(err)

      // throw new Errors.InvalidInput(`expected "_time"`)
    }

    // if (isUnsignedType(type)) return []

    const sourceStub = this.key
    const { properties } = model
    return Object.keys(resource).map(linkProp => {
      const property = properties[linkProp]
      if (!property || isInlinedProperty({ models, property })) {
        return
      }

      const { ref } = property
      if (!ref) return

      if (isEnumProperty({ models, property })) return

      const targetStub = resource[linkProp]
      if (!targetStub) return

      const targetModel = models[targetStub[TYPE]]
      const backlinkProps = this.getBacklinkProperties({
        sourceModel: model,
        targetModel,
        linkProp
      })

      if (!backlinkProps.length) return

      // const sourceParsedStub = parseStub(sourceStub)
      // const targetParsedStub = parseStub(targetStub)
      const blItem:IBacklinkItem = {
        [TYPE]: 'tradle.BacklinkItem',
        source: this.stub,
        target: targetStub,
        linkProp,
        backlinkProps
      }

      if (time) {
        blItem._time = time
      }

      return blItem
    })
    .filter(_.identity)
    // .reduce((byProp, value) => {
    //   byProp[value.forward] = value
    //   return byProp
    // }, {})
  }

  public toDynamoUpdate = () => DynamoUtils.createUpdateOptionsFromDiff(this.diff)
  public static toDynamoUpdate = diff => DynamoUtils.createUpdateOptionsFromDiff(diff)

  public static getPrimary

  public version = () => {
    return this.set(buildResource.version({
      [SIG]: this.get(SIG) || this.originalResource[SIG],
      ...this.resource
    }))
  }

  private _assertDiff = () => {
    if (!this.isModified()) {
      debugger
      throw new Error('no changes to save!')
    }
  }

  private _ensureHaveStore = () => {
    if (!this.store) {
      throw new Errors.InvalidInput(`provide "store" in constructor if you want to run this operation'`)
    }
  }

  private omitBacklinks = (resource=this.resource) => omitBacklinks({
    model: this.model,
    resource
  })

  private _resetDiff = () => {
    this.originalResource = _.cloneDeep(this.omitBacklinks())
    this.diff = []
  }
}

export const getPrimaryKeys = ({ models, model, resource }: {
  models?: Models
  model?: Model
  resource: any
}) => {
  if (!model) model = models[resource[TYPE]]

  return _.pick(resource, getPrimaryKeysProperties(model))
}

export const getPrimaryKeysProperties = (model: Model) => {
  return _.values(getPrimaryKeySchema(model)).concat(TYPE)
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

export const serializePrimaryKeyWithSchema = (resource: any, schema: IDBKey):string => {
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

export const parseKeyString = ({ key, schema, models, model }: {
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

export const serializeKey = ({ key, model, models }: {
  key: any
  model?: Model
  models?: Models
}) => {
  if (!model) {
    model = models[key[TYPE]]
  }

  return serializePrimaryKeyWithSchema(key, getPrimaryKeySchema(model))
}

// TODO: move to validate-model
export const getBacklinkProperties = ({
  models,
  sourceModel,
  targetModel,
  linkProp
}: GetBacklinkPropertiesInput):string[] => {
  const targetAncestors = getAncestors({ models, model: targetModel })
  const targetModels = [targetModel].concat(targetAncestors)
  return _.chain(targetModels)
    .flatMap(targetModel => {
      const { properties } = targetModel
      return Object.keys(properties).filter(propertyName => {
        const property = properties[propertyName]
        const { items } = property
        if (!items) return

        const { ref, backlink } = items
        if (backlink !== linkProp) return

        if (ref === sourceModel.id) return true

        // e.g. a forms backlink might have ref "tradle.Form"
        // linkProp might be "tradle.PhotoID"
        // check: is tradle.PhotoID a descendant of tradle.Form?
        return isDescendantOf({ models, a: sourceModel.id, b: ref })
      })
    })
    .uniq()
    .value()
}

export const getForwardLinks = opts => new Resource(opts).getForwardLinks()

const ensurePlainObject = obj => {
  if (!isPlainObject(obj, { allowBuffers: true })) {
    throw new Errors.InvalidInput(`expected plain object`)
  }
}

const getSoftDiff = (diff: Diff) => diff.filter(diffItem => {
  if (_.isEqual(diffItem.path, ['_time'])) {
    return false
  }

  return true
})

const hasVersionIncreased = (resource: Resource) => {
  const originalVersion = resource.getOriginal(VERSION) || 0
  return resource.get(VERSION) > originalVersion
}
