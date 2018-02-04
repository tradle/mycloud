import { EventEmitter} from 'events'
import _ = require('lodash')
import Pack = require('@tradle/models-pack')
import { TYPE } from '@tradle/constants'
import {
  createModelStore as createStore,
  ModelStore as DBModelStore
} from '@tradle/dynamodb'

import { Level } from './logger'
import { CacheableBucketItem } from './cacheable-bucket-item'
import Errors = require('./errors')
import {
  Tradle,
  Bucket,
  Buckets,
  Friends,
  Logger
} from './types'

import {
  PRIVATE_CONF_BUCKET
} from './constants'

import {
  toModelsMap
} from './utils'

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

export type ModelsPack = {
  models?: any
  lenses?: any
  namespace?: string
}

export class ModelStore extends EventEmitter {
  public cumulativePackKey: string
  public cumulativeGraphqlSchemaKey: string
  public cumulativePackItem: CacheableBucketItem
  public cumulativeGraphqlSchemaItem: CacheableBucketItem
  public myModelsPack: ModelsPack
  public cumulativeModelsPack: ModelsPack
  public bucket: Bucket
  private tradle: Tradle
  private logger: Logger
  private cache: DBModelStore
  private myDomain: string
  private myNamespace: string
  private myCustomModels: any
  private baseModels: any
  private baseModelsIds: string[]
  constructor (tradle:Tradle) {
    super()

    this.tradle = tradle
    this.logger = tradle.logger.sub('modelstore')
    this.baseModels = tradle.models
    this.baseModelsIds = Object.keys(this.baseModels)
    this.myCustomModels = {}
    this.cache = createStore({
      models: this.baseModels,
      onMissingModel: this.onMissingModel.bind(this)
    })

    this.cache.on('update', () => this.emit('update'))
    this.bucket = this.tradle.buckets.PrivateConf
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
      this.addModels(pack.models)
    })
  }

  public get = async (id) => {
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

  public get models () {
    return this.cache.models
  }

  public getMyCustomModels () {
    return _.clone(this.myCustomModels)
  }

  /**
   * Add a models pack to the cumulative models pack
   * update related resources (e.g. graphql schema)
   */
  public addModelsPack = async ({
    modelsPack,
    validateAuthor=true,
    validateUpdate=true,
    key
  }: {
    modelsPack: any,
    validateAuthor?: boolean,
    validateUpdate?: boolean,
    key?: string
  }) => {
    if (validateAuthor) {
      await this.validateModelsPackNamespaceOwner(modelsPack)
    }

    if (validateUpdate) {
      await this.validateModelsPackUpdate(modelsPack)
    }

    const current = await this.getCumulativeModelsPack()
    let cumulative
    if (current) {
      cumulative = omitNamespace({
        modelsPack: current,
        namespace: modelsPack.namespace
      })

      extendModelsPack(cumulative, modelsPack)
    } else {
      cumulative = _.omit(modelsPack, ['namespace'])
    }

    this.logger.debug(`added ${modelsPack.namespace} models pack`)
    if (!key) key = getModelsPackConfKey(modelsPack)

    await Promise.all([
      this.bucket.gzipAndPut(key, modelsPack),
      this.bucket.gzipAndPut(this.cumulativePackKey, cumulative),
      // this.updateGraphqlSchema({ cumulativeModelsPack: cumulative })
    ])

    this.emit('update:cumulative', cumulative)
    return cumulative
  }

  public updateGraphqlSchema = async (opts:any={}) => {
    let { cumulativeModelsPack } = opts
    if (!cumulativeModelsPack) cumulativeModelsPack = await this.getCumulativeModelsPack()

    const models = getCumulative(this, cumulativeModelsPack, false)
    const { exportSchema } = require('./bot/graphql')
    const schema = exportSchema({ models })
    await this.bucket.gzipAndPut(this.cumulativeGraphqlSchemaKey, schema)
  }

  public loadModelsPacks = async () => {
    const cumulative = await this.getCumulativeModelsPack()
    if (cumulative) {
      this.logger.debug('loaded cumulative models pack')
      this.emit('update:cumulative', cumulative)
    }
  }

  public getCumulativeModelsPack = async (opts?:any) => {
    try {
      return await this.cumulativePackItem.get(opts)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return null
    }
  }

  public getSavedGraphqlSchema = async () => {
    const schema = await this.bucket.getJSON(this.cumulativeGraphqlSchemaKey)
    return require('./bot/graphql').importSchema(schema)
  }

  public getGraphqlSchema = async () => {
    try {
      return await this.getSavedGraphqlSchema()
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return require('./bot/graphql').exportSchema({
        models: this.models
      })
    }
  }

  public getModelsForNamespace = (namespace:string) => {
    const prefix = namespace + '.'
    const models = _.filter(this.models, (value:any, key:string) => key.startsWith(prefix))
    return Pack.pack({ namespace, models })
  }

  public saveCustomModels = async ({
    modelsPack,
    key
  }: { modelsPack:ModelsPack, key?:string }) => {
    modelsPack = Pack.pack(modelsPack)
    const { namespace, models, lenses } = modelsPack
    if (namespace) {
      this.setMyNamespace(namespace)
    }

    this.setCustomModels(modelsPack)

    await this.addModelsPack({
      validateAuthor: false,
      modelsPack: this.myModelsPack,
      key
    })
  }

  public setCustomModels = (modelsPack: ModelsPack) => {
    modelsPack = Pack.pack(modelsPack)
    const {
      namespace=getNamespace(modelsPack),
      models=[],
      lenses=[]
    } = modelsPack

    if (!namespace) {
      throw new Error('expected "namespace"')
    }

    this.cache.removeModels(this.myCustomModels)
    this.addModels(models)
    this.myModelsPack = modelsPack
    this.myNamespace = namespace
    this.myCustomModels = _.clone(models)
  }

  public setMyNamespace = (namespace:string) => {
    this.myNamespace = namespace
    this.myDomain = toggleDomainVsNamespace(namespace)
  }

  public setMyDomain = (domain:string) => {
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

  public getModelsPackByDomain = async (domain) => {
    return await this.bucket.getJSON(getModelsPackConfKey(domain))
  }

  public validateModelsPackNamespaceOwner = async (pack) => {
    if (!pack.namespace) {
      throw new Error(`ignoring ModelsPack sent by ${pack._author}, as it isn't namespaced`)
    }

    const domain = getDomain(pack)
    const friend = await this.tradle.friends.getByDomain(domain)
    if (!pack._author) {
      await this.tradle.identities.addAuthorInfo(pack)
    }

    if (friend._identityPermalink !== pack._author) {
      throw new Error(`ignoring ModelsPack sent by ${pack._author}.
Domain ${domain} (and namespace ${pack.namespace}) belongs to ${friend._identityPermalink}`)
    }
  }

  public validateModelsPackUpdate = async (pack) => {
    const ret = {
      changed: true
    }

    const domain = getDomain(pack)
    try {
      const current = await this.getModelsPackByDomain(domain)
      validateUpdate(current, pack)
      ret.changed = current.versionId !== pack.versionId
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
    }

    return ret
  }

  public validateModelsPack = async (modelsPack) => {
    await this.validateModelsPackNamespaceOwner(modelsPack)
    return await this.validateModelsPackUpdate(modelsPack)
  }

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

  private onMissingModel = async (id):Promise<void> => {
    const modelsPack = await this.getModelsPackByDomain(getDomain(id))
    this.cache.addModels(modelsPack.models)
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

export const createModelStore = (tradle:Tradle) => new ModelStore(tradle)
export const toggleDomainVsNamespace = str => str.split('.').reverse().join('.')
export const validateUpdate = (current, updated) => {
  const lost = _.difference(current, Object.keys(updated))
  if (lost.length) {
    throw new Error(`models cannot be removed, only deprecated: ${lost.join(', ')}`)
  }
}

const getCumulative = (modelStore:ModelStore, foreign, customOnly) => {
  const domestic = customOnly ? modelStore.getMyCustomModels() : modelStore.models
  return {
    ...toModelsMap(_.get(foreign, 'models', [])),
    ...domestic
  }
}

const omitNamespace = ({ modelsPack, namespace }) => {
  let { models=[], lenses=[] } = modelsPack
  models = models
    .filter(model => Pack.getNamespace(model.id) !== namespace)

  lenses = lenses
    .filter(lens => Pack.getNamespace(lens.id) !== namespace)

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
