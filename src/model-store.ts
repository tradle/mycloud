import { EventEmitter} from 'events'
import _ = require('lodash')
import mem = require('mem')
import ModelsPack = require('@tradle/models-pack')
import { TYPE } from '@tradle/constants'
import {
  createModelStore as createStore,
  ModelStore as DBModelStore
} from '@tradle/dynamodb'
import Logger from './logger'
import Friends from './friends'
import { Buckets } from './buckets'
import Errors = require('./errors')
import Tradle from './tradle'
import { Bucket } from './bucket'
import {
  PRIVATE_CONF_BUCKET
} from './constants'

const CUMULATIVE_PACK_KEY = PRIVATE_CONF_BUCKET.modelsPack
const MODELS_PACK = 'tradle.ModelsPack'
const MODELS_PACK_CACHE_MAX_AGE = 60000
const MODELS_FOLDER = 'models'
const BUILT_IN_NAMESPACES = [
  'tradle',
  'io.tradle'
]

export class ModelStore extends EventEmitter {
  private tradle: Tradle
  private logger: Logger
  private cache: DBModelStore
  private myDomain: string
  private myNamespace: string
  private _myCustomModels: any
  private baseModels: any
  constructor (tradle:Tradle) {
    super()

    this.tradle = tradle
    this.logger = tradle.logger.sub('modelstore')
    this.baseModels = tradle.models
    this._myCustomModels = {}
    this.cache = createStore({
      models: this.baseModels,
      onMissingModel: this.onMissingModel.bind(this)
    })

    this.cache.on('update', () => this.emit('update'))
  }

  get bucket():Bucket {
    return this.tradle.buckets.PrivateConf
  }

  public get = async (id) => {
    if (BUILT_IN_NAMESPACES.includes(ModelsPack.getNamespace(id))) {
      return this.cache.models[id]
    }

    return await this.cache.get(id)
  }

  public get models () {
    return this.cache.models
  }

  public getAllCustomModels () {
    return _.omit(this.models, this.baseModels)
  }

  public getMyCustomModels () {
    return _.clone(this._myCustomModels)
    // return this.getModelsForNamespace(this.myNamespace)
  }

  public updateCumulativeModelsPackWithPack = async (pack) => {
    await this.validateInboundModelsPack(pack)
    const current = await this.getCumulativeModelsPack()
    let cumulative
    if (current) {
      const { namespace } = pack
      const models = current.models
        .filter(model => ModelsPack.getNamespace(model) !== namespace)
        .concat(pack.models)

      cumulative = ModelsPack.pack({ models })
    } else {
      cumulative = pack
    }

    await this.bucket.putJSON(CUMULATIVE_PACK_KEY, cumulative)
    return cumulative
  }

  public getCumulativeModelsPack = async () => {
    try {
      return await this.bucket.getJSON(CUMULATIVE_PACK_KEY)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return null
    }
  }

  public getModelsForNamespace = (namespace:string) => {
    const prefix = namespace + '.'
    const models = _.filter(this.models, (value:any, key:string) => key.startsWith(prefix))
    return ModelsPack.pack({ namespace, models })
  }

  public setMyCustomModels = (models) => {
    // ModelsPack.validate(ModelsPack.pack({ models }))
    this.cache.removeModels(this._myCustomModels)
    this.addModels(models)
    this._myCustomModels = _.clone(models)
  }

  public setMyNamespace = (namespace:string) => {
    this.myNamespace = namespace
    this.myDomain = namespace.split('.').reverse().join('.')
  }

  public setMyDomain = (domain:string) => {
    this.myDomain = domain
    this.myNamespace = domain.split('.').reverse().join('.')
  }

  public buildMyModelsPack = () => {
    const models = this.getMyCustomModels()
    const namespace = this.myNamespace || ModelsPack.getNamespace(_.values(models))
    return ModelsPack.pack({ namespace, models })
  }

  public addModels = (models) => {
    this.cache.addModels(models)
  }

  public getModelsPackByDomain = async (domain) => {
    return await this.tradle.buckets.PrivateConf.getJSON(getModelsPackConfKey(domain))
  }

  public validateInboundModelsPack = async (pack)  => {
    if (!pack.namespace) {
      throw new Error(`ignoring ModelsPack sent by ${pack._author}, as it isn't namespaced`)
    }

    // ModelsPack.validate(pack)
    const domain = ModelsPack.getDomain(pack)
    const friend = await this.tradle.friends.getByDomain(domain)
    if (!pack._author) {
      await this.tradle.identities.addAuthorInfo(pack)
    }

    if (friend._identityPermalink !== pack._author) {
      throw new Error(`ignoring ModelsPack sent by ${pack._author}.
Domain ${domain} belongs to ${friend._identityPermalink}`)
    }
  }

  public saveModelsPack = async (pack) => {
    await this.validateInboundModelsPack(pack)
    await this.tradle.buckets.PrivateConf.putJSON(getModelsPackConfKey(pack), pack)
  }

  private onMissingModel = async (id):Promise<void> => {
    const modelsPack = await this.getModelsPackByDomain(ModelsPack.getDomain(id))
    this.cache.addModels(modelsPack.models)
  }
}

const getModelsPackConfKey = domainOrPack => {
  if (typeof domainOrPack === 'string') {
    return `${MODELS_FOLDER}/${domainOrPack}/pack.json`
  }

  if (domainOrPack[TYPE] === MODELS_PACK) {
    return getModelsPackConfKey(ModelsPack.getDomain(domainOrPack))
  }

  throw new Error('expected domain or ModelsPack')
}

export const createModelStore = (tradle:Tradle) => new ModelStore(tradle)
