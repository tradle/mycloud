import _ from 'lodash'
import Errors from '../errors'
import {
  Bot,
  Model,
  Models,
  IHasModels,
  ITradleObject,
  ResourceStub,
  Backlinks
} from '../types'

import { UNSIGNED_TYPES } from '../constants'
import { mixin as modelsMixin } from './models-mixin'
import {
  parseStub
} from '../utils'

import { Resource } from './resource'

export class RCache implements IHasModels {
  public bot: Bot
  public byPK: Map<String, Resource>
  // public byLink: Map<String, Resource>

  get models() { return this.bot.models }
  get backlinks() { return this.bot.backlinks }

  // IHasModels
  buildResource: (model: string|Model) => any
  buildStub: (resource: ITradleObject) => any
  validate: (resource: ITradleObject) => any

  constructor({ bot }: {
    bot: Bot
  }) {
    modelsMixin(this)

    this.bot = bot
    this.byPK = new Map<String, Resource>()
  }

  public create = (type: string) => {
    const r = new Resource({
      bot: this.bot,
      model: this.models[type]
    })

    this.add(r)
    return r
  }

  public add = (resource: Resource) => {
    // if (!resource.get(SIG) && !UNSIGNED_TYPES.includes(resource.get(TYPE))) {
    //   throw new Errors.InvalidInput('expected resource to be signed')
    // }

    if (resource.isSigned()) {
      this.byPK.set(resource.keyString, resource)
      this._connect(resource)
    } else {
      this._subscribe(resource)
    }
  }

  private _subscribe = (resource: Resource) => {
    resource.once('sign', () => this.add(resource))
  }

  private _connect = (resource: Resource) => {
    const { model, stub } = resource
    const forwardLinks = resource.getForwardLinks(this.backlinks)
    if (!forwardLinks.length) return

    forwardLinks.forEach(blItem => {
      const { targetStub, backlinkProps } = blItem
      const target = this.byPK.get(Resource.serializeKey({
        key: targetStub,
        models: this.models
      }))

      if (!target) return

      backlinkProps.forEach(backlink => target.updateBacklink({
        backlink,
        stub: resource.stub
      }))
    })
  }
}

export const toStableStub = stub => _.omit(stub, ['title', 'id', '_link'])

export const updateBacklink = ({ target, backlink, stub }: {
  target: Resource
  backlink: string
  stub: any
}) => {
  const stable = toStableStub(stub) // parseStub(stub)
  const arr = target.get(backlink) || []
  let idx = arr.findIndex(stub => _.isEqual(toStableStub(stub), stable))
  if (idx === -1) idx = arr.length

  arr.push(stub)
  target.set(backlink, arr)
}
