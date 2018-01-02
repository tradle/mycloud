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

const MODELS_PACK = 'tradle.ModelsPack'
const MODELS_PACK_CACHE_MAX_AGE = 60000
const BUILT_IN_NAMESPACES = [
  'tradle',
  'io.tradle'
]

export class ModelStore extends EventEmitter {
  private tradle: Tradle
  private store: DBModelStore
  private myDomain: string
  private myNamespace: string
  private _myCustomModels: any
  private baseModels: any
  constructor (tradle:Tradle) {
    super()

    this.tradle = tradle
    this.baseModels = tradle.models
    this._myCustomModels = {}
    this.store = createStore({
      models: this.baseModels,
      onMissingModel: this.onMissingModel.bind(this)
    })

    this.store.on('update', () => this.emit('update'))
  }

  public get = async (id) => {
    if (BUILT_IN_NAMESPACES.includes(ModelsPack.getNamespace(id))) {
      return this.store.models[id]
    }

    return await this.store.get(id)
  }

  public get models () {
    return this.store.models
  }

  public get allCustomModels () {
    return _.omit(this.models, this.baseModels)
  }

  public get myCustomModels () {
    return _.clone(this._myCustomModels)
    // return this.getModelsForNamespace(this.myNamespace)
  }

  public getModelsForNamespace = (namespace:string) => {
    const prefix = namespace + '.'
    const models = _.filter(this.models, (value:any, key:string) => key.startsWith(prefix))
    return ModelsPack.pack(models)
  }

  public setMyCustomModels = (models) => {
    // ModelsPack.validate(ModelsPack.pack(models))
    this.store.removeModels(this._myCustomModels)
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

  public buildMyModelsPack = () => ModelsPack.pack(this.myCustomModels)

  public addModels = (models) => {
    this.store.addModels(models)
  }

  public getModelsPackByDomain = async (domain) => {
    return await this.tradle.buckets.PrivateConf.getJSON(getModelsPackConfKey(domain))
  }

  public saveModelsPack = async (pack) => {
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

    await this.tradle.buckets.PrivateConf.putJSON(getModelsPackConfKey(pack), pack)
  }

  private onMissingModel = async (id):Promise<void> => {
    const modelsPack = await this.getModelsPackByDomain(ModelsPack.getDomain(id))
    this.store.addModels(modelsPack.models)
  }
}

const getModelsPackConfKey = domainOrPack => {
  if (typeof domainOrPack === 'string') {
    return `models/${domainOrPack}/pack.json`
  }

  if (domainOrPack[TYPE] === MODELS_PACK) {
    return getModelsPackConfKey(ModelsPack.getDomain(domainOrPack))
  }

  throw new Error('expected domain or ModelsPack')
}

export const createModelStore = (tradle:Tradle) => new ModelStore(tradle)
