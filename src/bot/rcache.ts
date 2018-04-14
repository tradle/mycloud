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

import { Resource, serializeKey } from './resource'

export class RCache implements IHasModels {
  public bot: Bot
  private byPermalink: Map<String, Resource>
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
    this.byPermalink = new Map<String, Resource>()
  }

  public get = (permalink: string) => {
    return this.byPermalink.get(permalink)
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
      this.byPermalink.set(resource.permalink, resource)
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
    const forwardLinks = resource.getForwardLinks()
    if (!forwardLinks.length) return

    forwardLinks.forEach(blItem => {
      const { source, target, backlinkProps } = blItem
      const resource = this.byPermalink.get(target._permalink)
      if (!resource) return

      backlinkProps.forEach(backlink => resource.updateBacklink({
        backlink,
        stub: source
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
