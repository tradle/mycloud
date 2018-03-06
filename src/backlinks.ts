import _ from 'lodash'
import buildResource from '@tradle/build-resource'
import { TYPE } from '@tradle/constants'
import {
  parseId,
  parseStub,
  uniqueStrict
} from './utils'

import {
  ITradleObject,
  ModelStore,
  Models,
  Model,
  Middleware,
  KeyValueTable,
  ResourceStub,
  ParsedResourceStub
} from './types'

import { getRecordsFromEvent } from './db-utils'
import Errors from './errors'

interface ResourceProperty extends ParsedResourceStub {
  property: string
}

export type ForwardLink = {
  source: ITradleObject
  sourceStub: ResourceStub
  forward: string
  // backlinkModel: Model
  back: string
  linkedModel: Model
  targetStub: ResourceStub
  targetParsedStub: ParsedResourceStub
}

export type ForwardLinks = {
  [propertyName:string]: ForwardLink
}

export type Backlink = string[]

export class Backlinks {
  private store: KeyValueTable
  private modelStore: ModelStore
  constructor ({ store, modelStore }: {
    store: KeyValueTable
    modelStore: ModelStore
  }) {
    this.store = store
    this.modelStore = modelStore
  }

  private get models() {
    return this.modelStore.models
  }

  private getForwardLinks = (resource) => {
    return getForwardLinks({ models: this.models, resource })
  }

  public updateBacklinksFromChange = async ({ model, before, after }) => {
    const forwardLinksBefore = this.getForwardLinks(before)
    const forwardLinksAfter = this.getForwardLinks(after)
    const props = uniqueStrict(
      Object.keys(forwardLinksBefore)
        .concat(Object.keys(forwardLinksAfter))
    )

    const changes = props.map(propertyName => {
      const valBefore = forwardLinksBefore[propertyName]
      const valAfter = forwardLinksAfter[propertyName]
      if (_.isEqual(valBefore, valAfter)) return

      return {
        before: valBefore,
        after: valAfter
      }
    })
    .filter(_.identity)

    // TODO: apply changes
  }

  /**
   * updates the backlinks of resources to which this resource has forward links
   * @param {ITradleObject} resource
   */
  public updateBacklinks = async (resource:ITradleObject) => {
    const { models } = this
    const forwardLinks = this.getForwardLinks(resource)
    if (!_.size(forwardLinks)) return

    await Promise.all(_.map(forwardLinks, (f => this.updateBacklink(f))))
  }

  public updateBacklink = async (forwardLink: ForwardLink, remove?: boolean) => {
    const {
      sourceStub,
      targetStub,
      targetParsedStub,
      forward,
      back,
      linkedModel
    } = forwardLink

    const { id } = targetStub
    const key = getBacklinkKey({ ...targetParsedStub, property: back })
    let current:Backlink
    try {
      current = await this.store.get(key)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      current = []
    }

    const updated = updateBacklink(current, sourceStub.id)
    if (_.isEqual(current, updated)) return

    await this.store.put(key, updated)

    // await this.store.update(key, {
    //   UpdateExpression: 'ADD #value :rlink',
    //   ExpressionAttributeNames: {
    //     '#value': 'value'
    //   },
    //   ExpressionAttributeValues: {
    //     ':rlink': buildResource.id(resource)
    //   },
    //   ConditionExpression: 'NOT contains(#value, :rlink)'
    // })
  }

  public getBacklink = async (opts: ResourceProperty):Promise<Backlink> => {
    return await this.store.get(getBacklinkKey(opts))
  }
}

export const getBacklinkKey = ({ type, permalink, property }: ResourceProperty) => {
  return `${type}_${permalink}.${property}`
}

export const getForwardLinks = ({ models, resource }: {
  models: Models,
  resource: ITradleObject
}):ForwardLinks => {
  const type = resource[TYPE]
  const model = models[type]
  if (!model) throw new Errors.InvalidInput(`missing model: ${type}`)

  const sourceStub = buildResource.stub({ models, resource })
  const { properties } = model
  return Object.keys(resource)
    .map(forwardLinkPropertyName => {
      const property = properties[forwardLinkPropertyName]
      if (!property) return

      const { ref } = property
      if (!ref) return

      const targetStub = resource[forwardLinkPropertyName]
      if (!targetStub) return

      const targetParsedStub = parseStub(targetStub)
      const { type } = targetParsedStub
      const linkedModel = models[type]
      const backlinkPropertyName = getBacklinkForForwardLink({
        models,
        resourceModel: model,
        linkedModel,
        forwardLinkPropertyName: forwardLinkPropertyName
      })

      if (!backlinkPropertyName) return

      return {
        source: resource,
        sourceStub,
        forward: forwardLinkPropertyName,
        linkedModel,
        back: backlinkPropertyName,
        targetStub,
        targetParsedStub
      }
    })
    .filter(_.identity)
    .reduce((byProp, value) => {
      byProp[value.forward] = value
      return byProp
    }, {})
}

export const getBacklinkForForwardLink = ({
  models,
  resourceModel,
  linkedModel,
  forwardLinkPropertyName
}: {
  models: Models
  // e.g.
  //   resourceModel: tradle.Verification
  //   linkedModel: tradle.PhotoID
  //   forwardLinkPropertyName: "document"
  resourceModel: Model
  linkedModel: Model
  forwardLinkPropertyName: string
}) => {
  const { properties } = linkedModel
  return Object.keys(properties)
    .find(propertyName => {
      const property = properties[propertyName]
      const { items } = property
      if (!items) return

      const { ref, backlink } = items
      return ref && backlink === forwardLinkPropertyName
    })
}

const updateBacklink = (ids:Backlink, id:string):Backlink => {
  const stubs = ids.map(parseId)
  const update = parseId(id)
  const idx = stubs.findIndex(stub => stub.permalink === update.permalink)
  if (idx === -1) {
    return ids.concat(id)
  }

  if (stubs[idx].link === update.link) return ids

  return ids.map((oldId, i) => i === idx ? id : oldId)
}
