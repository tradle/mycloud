import { EventEmitter } from 'events'
import _ from 'lodash'
import Pack from '@tradle/models-pack'
import { TYPE, TYPES } from '@tradle/constants'
const FORM = TYPES.FORM
const basicModels = require('@tradle/models').models
import { createModelStore as createStore, ModelStore as DBModelStore } from '@tradle/dynamodb'

import { CacheableBucketItem } from './cacheable-bucket-item'
import Errors from './errors'
import { Bucket, Friends, Logger, ModelsPack, Models, Identities } from './types'

import { PRIVATE_CONF_BUCKET } from './constants'

import { toModelsMap } from './utils'

const parseJSON = obj => JSON.parse(obj)
const MODELS_PACK = 'tradle.ModelsPack'
const MODELS_PACK_CACHE_MAX_AGE = 60000
const MINUTE = 60000

const getDomain = pack => {
  if (typeof pack === 'object') {
    pack = { ...pack, [TYPE]: MODELS_PACK }
  }

  return Pack.getDomain(pack)
}

const getNamespace = pack => {
  if (typeof pack === 'object') {
    pack = { ...pack, [TYPE]: MODELS_PACK }
  }

  return Pack.getNamespace(pack)
}

// type CacheablePacks = {
//   [domain:string]: CacheableBucketItem
// }

type Lenses = {
  [id: string]: any
}

type ModelStoreOpts = {
  friends: Friends
  identities: Identities
  logger: Logger
  models: Models
  bucket: Bucket
}

export class ModelStore extends EventEmitter {
  public cumulativePackKey: string
  public cumulativeGraphqlSchemaKey: string
  public cumulativePackItem: CacheableBucketItem
  public cumulativeGraphqlSchemaItem: CacheableBucketItem
  public myModelsPack: ModelsPack
  public cumulativeModelsPack: ModelsPack
  public bucket: Bucket
  public lenses: any
  private logger: Logger
  private cache: DBModelStore
  private myDomain: string
  private myNamespace: string
  private myCustomModels: any
  private baseModels: any
  private baseModelsIds: string[]
  private components: ModelStoreOpts
  private get friends() {
    return this.components.friends
  }
  private get identities() {
    return this.components.identities
  }
  constructor(components: ModelStoreOpts) {
    super()

    const { models, logger, bucket } = components
    this.components = components
    this.logger = logger.sub('modelstore')
    this.baseModels = models
    this.baseModelsIds = Object.keys(this.baseModels)
    this.myCustomModels = {}
    this.lenses = {}
    this.cache = createStore({
      models: this.baseModels,
      onMissingModel: this.onMissingModel.bind(this)
    })

    this.cache.on('update', () => this.emit('update'))
    this.bucket = bucket
    this.cumulativePackKey = PRIVATE_CONF_BUCKET.modelsPack
    this.cumulativeGraphqlSchemaKey = PRIVATE_CONF_BUCKET.graphqlSchema
    this.cumulativePackItem = new CacheableBucketItem({
      bucket: this.bucket,
      key: this.cumulativePackKey,
      ttl: 5 * MINUTE,
      parse: parseJSON
    })

    this.cumulativeGraphqlSchemaItem = new CacheableBucketItem({
      bucket: this.bucket,
      key: this.cumulativeGraphqlSchemaKey,
      ttl: 5 * MINUTE,
      parse: parseJSON
    })

    this.on('update:cumulative', pack => {
      this.cumulativeModelsPack = pack
      if (!pack.models) return

      // prevent collisions
      const models = _.keyBy(pack.models, 'id')
      this.removeModels(models)
      this.addModels(models)
    })
  }

  public get = async id => {
    const namespace = Pack.getNamespace(id)
    let model = this.cache.models[id]
    if (!model) {
      await this.onMissingModel(id)
      model = this.cache.models[id]
    }

    if (!model) {
      throw new Errors.NotFound(`model with id: ${id}`)
    }

    return model
  }

  public get models() {
    return this.cache.models
  }

  public getMyCustomModels() {
    return _.clone(this.myCustomModels)
  }

  /**
   * Add a models pack to the cumulative models pack
   * update related resources (e.g. graphql schema)
   */
  public addModelsPack = async ({
    modelsPack,
    validateAuthor = true,
    allowRemoveModels,
    // validateUpdate=true,
    key
  }: {
    modelsPack: any
    validateAuthor?: boolean
    allowRemoveModels?: boolean
    // validateUpdate?: boolean
    key?: string
  }) => {
    if (validateAuthor) {
      await this.validateModelsPackNamespaceOwner(modelsPack)
    }

    const domain = getDomain(modelsPack)
    let current: ModelsPack
    try {
      current = await this.getModelsPackByDomain(domain)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }

    if (current && !allowRemoveModels) {
      ensureNoModelsRemoved(current, modelsPack)
    }

    const currentCumulative = await this.getCumulativeModelsPack()
    let cumulative
    if (currentCumulative) {
      cumulative = omitNamespace({
        modelsPack: currentCumulative,
        namespace: modelsPack.namespace
      })

      extendModelsPack(cumulative, modelsPack)
    } else {
      cumulative = _.omit(modelsPack, ['namespace'])
    }

    this.logger.debug(`added ${modelsPack.namespace} models pack`)

    const assetKey = getModelsPackConfKey(modelsPack)
    const puts = [
      this.bucket.gzipAndPut(assetKey, modelsPack),
      this.bucket.gzipAndPut(this.cumulativePackKey, cumulative)
    ]

    if (key && key !== assetKey) {
      puts.push(this.bucket.gzipAndPut(key, modelsPack))
    }

    await Promise.all(puts)

    this.emit('update:cumulative', cumulative)
    return cumulative
  }

  public updateGraphqlSchema = async (opts: any = {}) => {
    let { cumulativeModelsPack } = opts
    if (!cumulativeModelsPack) cumulativeModelsPack = await this.getCumulativeModelsPack()

    const models = getCumulative(this, cumulativeModelsPack, false)
    const { exportSchema } = require('./graphql')
    const schema = exportSchema({ models })
    await this.bucket.gzipAndPut(this.cumulativeGraphqlSchemaKey, schema)
  }

  public loadModelsPacks = async () => {
    const cumulative = await this.getCumulativeModelsPack()
    if (cumulative) {
      this.logger.debug('loaded cumulative models pack')
      this.emit('update:cumulative', cumulative)
    } else {
      this.logger.debug('no cumulative models pack found')
    }
  }

  public getCumulativeModelsPack = async (opts?: any) => {
    let form = basicModels[FORM]
    const modificationHistory = form.modificationHistory
    try {
      let modelsPack = await this.cumulativePackItem.get(opts)
      let { models } = modelsPack
      this.addFormBacklinks({ models })
      return modelsPack
    } catch (err) {
      Errors.ignoreNotFound(err)
      return null
    }
  }

  public getSavedGraphqlSchema = async () => {
    const schema = await this.bucket.getJSON(this.cumulativeGraphqlSchemaKey)
    return require('./graphql').importSchema(schema)
  }

  public getGraphqlSchema = async () => {
    try {
      return await this.getSavedGraphqlSchema()
    } catch (err) {
      Errors.ignoreNotFound(err)
      return require('./graphql').exportSchema({
        models: this.models
      })
    }
  }

  public getModelsForNamespace = (namespace: string) => {
    const prefix = namespace + '.'
    const models = _.filter(this.models, (value: any, key: string) => key.startsWith(prefix))
    return Pack.pack({ namespace, models })
  }

  public saveCustomModels = async ({
    modelsPack,
    key
  }: {
    modelsPack: ModelsPack
    key?: string
  }) => {
    modelsPack = Pack.pack(modelsPack)
    const { namespace, models, lenses } = modelsPack
    if (namespace) {
      this.setMyNamespace(namespace)
    }

    this.setCustomModels(modelsPack)

    await this.addModelsPack({
      validateAuthor: false, // our own models, no need to validate
      allowRemoveModels: false, // missing models can break the UI
      modelsPack: this.myModelsPack,
      key
    })
  }

  private addFormBacklinks = ({ models }) => {
    let formBacklinks = []
    let formProps = basicModels[FORM].properties
    for (let p in formProps) {
      let prop = formProps[p]
      if (prop.items && prop.items.backlink) formBacklinks.push({ [p]: prop })
    }

    models.forEach(m => {
      if (m.abstract || !m.subClassOf) return
      let sub = m
      while (sub && sub.subClassOf && sub.subClassOf !== FORM) sub = models[sub.subClassOf]

      if (sub && sub.subClassOf) {
        formBacklinks.forEach(bl => {
          let p = Object.keys(bl)[0]
          if (!m.properties[p])
            _.extend(m.properties, {
              [p]: bl[p]
            })
        })
      }
    })
  }
  public setCustomModels = (modelsPack: ModelsPack) => {
    modelsPack = Pack.pack(modelsPack)
    const { namespace = getNamespace(modelsPack), models = [], lenses = [] } = modelsPack

    if (!namespace) {
      throw new Error('expected "namespace"')
    }
    this.addFormBacklinks({ models })
    this.cache.removeModels(this.myCustomModels)
    this.addModels(models)
    this.myModelsPack = modelsPack
    this.myNamespace = namespace
    this.myCustomModels = _.clone(models)
    this.lenses = (modelsPack.lenses || []).reduce((byId, lens) => {
      byId[lens.id] = lens
      return byId
    }, {})
  }

  public setMyNamespace = (namespace: string) => {
    this.myNamespace = namespace
    this.myDomain = toggleDomainVsNamespace(namespace)
  }

  public setMyDomain = (domain: string) => {
    this.myDomain = domain
    this.myNamespace = toggleDomainVsNamespace(domain)
  }

  // public buildMyModelsPack = () => {
  //   const models = this.getCustomModels()
  //   const namespace = this.myNamespace || Pack.getNamespace(_.values(models))
  //   return Pack.pack({ namespace, models })
  // }

  public addModel = model => this.cache.addModel(model)
  public addModels = models => this.cache.addModels(models)
  public removeModels = models => this.cache.removeModels(models)

  public getModelsPackByDomain = async domain => {
    return await this.bucket.getJSON(getModelsPackConfKey(domain))
  }

  public validateModelsPackNamespaceOwner = async pack => {
    if (!pack.namespace) {
      throw new Error(`ignoring ModelsPack sent by ${pack._author}, as it isn't namespaced`)
    }

    const domain = getDomain(pack)
    const friend = await this.friends.getByDomain(domain)
    const fIdentityPermalink = friend.identity._permalink
    if (fIdentityPermalink !== pack._author) {
      throw new Error(`ignoring ModelsPack sent by ${pack._author}.
Domain ${domain} (and namespace ${pack.namespace}) belongs to ${fIdentityPermalink}`)
    }
  }

  // public validateModelsPackUpdate = async (pack) => {
  //   const ret = {
  //     changed: true
  //   }

  //   const domain = getDomain(pack)
  //   try {
  //     const current = await this.getModelsPackByDomain(domain)
  //     ensureNoModelsRemoved(current, pack)
  //     ret.changed = current.versionId !== pack.versionId
  //   } catch (err) {
  //     Errors.ignoreNotFound(err)
  //   }

  //   return ret
  // }

  // public validateModelsPack = async (modelsPack) => {
  //   await this.validateModelsPackNamespaceOwner(modelsPack)
  //   return await this.validateModelsPackUpdate(modelsPack)
  // }

  public getModelsPackConfKey = getModelsPackConfKey

  /**
   * Save a models pack to storage
   */
  // public saveModelsPack = async ({
  //   modelsPack,
  //   addToCumulative,
  //   validateAuthor,
  //   validateUpdate
  // }) => {
  //   const { changed } = await this.validateModelsPack(modelsPack)
  //   if (!changed) return false

  //   const tasks = [
  //     this.bucket.gzipAndPut(getModelsPackConfKey(modelsPack), modelsPack)
  //   ]

  //   if (addToCumulative) {
  //     tasks.push(this.addModelsPack({ modelsPack }))
  //   }

  //   await Promise.all(tasks)
  //   return true
  // }

  // private _saveModelsPack = async ({ modelsPack }) => {
  //   // const stop = this.logger.timeDebug(`saving ${modelsPack.namespace} models pack`)
  //   await Promise.all([
  //     this.bucket.gzipAndPut(getModelsPackConfKey(modelsPack), modelsPack),
  //     this.addModelsPack({ modelsPack })
  //   ])

  //   // stop()
  // }

  private onMissingModel = async (id): Promise<void> => {
    const modelsPack = await this.getModelsPackByDomain(getDomain(id))
    if (modelsPack && modelsPack.models) {
      this.cache.addModels(modelsPack.models)
    }

    const found = !!this.cache.models[id]
    this.logger.debug(`found missing model: ${found}`, { id })
  }
}

export const getModelsPackConfKey = domainOrPack => {
  if (typeof domainOrPack === 'string') {
    return `${PRIVATE_CONF_BUCKET.assetsFolder}/${domainOrPack}/models-pack.json`
  }

  if (domainOrPack[TYPE] === MODELS_PACK) {
    return getModelsPackConfKey(getDomain(domainOrPack))
  }

  throw new Error('expected domain or ModelsPack')
}

export const createModelStore = (components: ModelStoreOpts) => new ModelStore(components)
export const toggleDomainVsNamespace = str =>
  str
    .split('.')
    .reverse()
    .join('.')
export const ensureNoModelsRemoved = (current: ModelsPack, updated: ModelsPack) => {
  const before = (current.models || []).map(m => m.id)
  const after = (updated.models || []).map(m => m.id)
  const lost = _.difference(before, after)
  if (lost.length) {
    throw new Errors.InvalidInput(`models cannot be removed: ${lost.join(', ')}`)
  }
}

const getCumulative = (modelStore: ModelStore, foreign, customOnly) => {
  const domestic = customOnly ? modelStore.getMyCustomModels() : modelStore.models
  return {
    ...toModelsMap(_.get(foreign, 'models', [])),
    ...domestic
  }
}

const omitNamespace = ({ modelsPack, namespace }) => {
  let { models = [], lenses = [] } = modelsPack
  models = models.filter(model => Pack.getNamespace(model.id) !== namespace)

  lenses = lenses.filter(lens => Pack.getNamespace(lens.id) !== namespace)

  return Pack.pack({ models, lenses })
}

const extendModelsPack = (modelsPack, ...sourcePacks) => {
  sourcePacks.forEach(source => {
    const models = (modelsPack.models || []).concat(source.models || [])
    const lenses = (modelsPack.lenses || []).concat(source.lenses || [])
    modelsPack.models = _.uniqBy(models, 'id')
    modelsPack.lenses = _.uniqBy(lenses, 'id')
  })

  return modelsPack
}
