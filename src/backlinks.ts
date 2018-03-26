import _ from 'lodash'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import {
  parseId,
  parseStub,
  uniqueStrict,
  pluck,
  toPathValuePairs,
  RESOLVED_PROMISE
} from './utils'

import {
  ITradleObject,
  ModelStore,
  Models,
  Model,
  Middleware,
  KV,
  ResourceStub,
  ParsedResourceStub,
  ISaveEventPayload
} from './types'

import { getRecordsFromEvent } from './db-utils'
import Errors from './errors'

const { isDescendantOf, isInlinedProperty } = validateResource.utils

interface ResourceProperty extends ParsedResourceStub {
  property: string
}

export type ForwardLink = {
  source: ITradleObject
  sourceStub: ResourceStub
  sourceParsedStub: ParsedResourceStub
  sourceVersionId: string
  forward: string
  // backlinkModel: Model
  back: string
  targetModel: Model
  targetStub: ResourceStub
  targetParsedStub: ParsedResourceStub
  targetVersionId: string
}

// export type ForwardLinks = {
//   [propertyName:string]: ForwardLink
// }

export type LatestToLink = {
  [latestId: string]: string
}

export type StoredResourceBacklinks = {
  [backlinkProperty: string]: LatestToLink
}

export type ResourceBacklinks = {
  [backlinkProperty: string]: ResourceStub[]
}

export type RemoveBacklinks = {
  [backlinkProperty: string]: string[]
}

// export type ExportedBacklinks

export type BacklinksContainer = {
  targetId: string
  backlinks: StoredResourceBacklinks
}

export type BacklinksContainers = {
  [targetId: string]: BacklinksContainer
}

export type BacklinksChange = {
  targetId: string
  set: StoredResourceBacklinks
  remove: RemoveBacklinks
}

// export type Backlink = string[]

type BacklinksOpts = {
  store: KV
  modelStore: ModelStore
}

export default class Backlinks {
  private store: KV
  private modelStore: ModelStore
  constructor ({ store, modelStore }: BacklinksOpts) {
    this.store = store
    this.modelStore = modelStore
  }

  private get models() {
    return this.modelStore.models
  }

  private getForwardLinks = (resource):ForwardLink[] => {
    return getForwardLinks({ models: this.models, resource })
  }

  public getBacklinks = async ({ type, permalink }: {
    type: string
    permalink: string
  }):Promise<ResourceBacklinks> => {
    const key = getBacklinkKey(getLatestVersionId({ type, permalink }))
    const backlinks = await this.store.get(key)
    return exportBacklinksContainer(backlinks)
  }

  // public processMessages = async (messages: ITradleMessage[]) => {
  //   messages = messages.filter(m => m.context)
  //   if (!messages.length) return

  //   const payloads = messages.map()
  // }

  public processChanges = async (resourceChanges: ISaveEventPayload[]) => {
    const backlinkChanges = this.getBacklinksChanges(resourceChanges)
    if (!backlinkChanges.length) return

    const [toPut, toUpdate] = _.partition(backlinkChanges, 'isNew')
    let savePuts = RESOLVED_PROMISE
    let saveUpdates = RESOLVED_PROMISE
    if (toPut.length) {
      savePuts = this.store.batchPut(toPut.map(({ targetId, set }) => ({
        key: getBacklinkKey(targetId),
        value: set
      })))
    }

    if (toUpdate.length) {
      saveUpdates = Promise.all(toUpdate.map(async (update) => {
        try {
          return await this.store.updateMap(getUpdateForBacklinkChange(update))
        } catch (err) {
          Errors.ignore(err, { name: 'ValidationException' })
          await this.store.put(getBacklinkKey(update.targetId), update.set)
        }
      }))
    }

    await Promise.all([savePuts, saveUpdates])
  }

  public getBacklinksChanges = (rChanges: ISaveEventPayload[]):BacklinksChange[] => {
    return getBacklinkChangesForChanges({
      models: this.models,
      changes: rChanges
    })
  }

  public updateBacklinksFromChange = async ({ model, change }: {
    model: Model
    change: ISaveEventPayload
  }) => {
    const { value, old } = change
    const forwardLinksBefore = this.getForwardLinks(old)
    const forwardLinksAfter = this.getForwardLinks(value)
    // const props = uniqueStrict(
    //   pluck(forwardLinksBefore.concat(forwardLinksAfter), 'forward')
    // )

    // const changes = props.map(propertyName => {
    //   const valBefore = forwardLinksBefore[propertyName]
    //   const valAfter = forwardLinksAfter[propertyName]
    //   if (_.isEqual(valBefore, valAfter)) return

    //   return {
    //     before: valBefore,
    //     after: valAfter
    //   }
    // })
    // .filter(_.identity)

    // TODO: apply changes
  }

  /**
   * updates the backlinks of resources to which this resource has forward links
   * @param {ITradleObject} resource
   */
  // public updateBacklinks = async (resource:ITradleObject) => {
  //   const { models } = this
  //   const forwardLinks = this.getForwardLinks(resource)
  //   if (!_.size(forwardLinks)) return

  //   await Promise.all(_.map(forwardLinks, (f => this.updateBacklink(f))))
  // }

  // public updateBacklink = async (forwardLink: ForwardLink, remove?: boolean) => {
  //   const {
  //     sourceStub,
  //     targetStub,
  //     targetParsedStub,
  //     forward,
  //     back,
  //     targetModel
  //   } = forwardLink

  //   const { id } = targetStub
  //   const key = getBacklinkKey({ ...targetParsedStub, property: back })
  //   let current:Backlink
  //   try {
  //     current = await this.store.get(key)
  //   } catch (err) {
  //     Errors.ignoreNotFound(err)
  //     current = []
  //   }

  //   const updated = updateBacklink(current, sourceStub.id)
  //   if (_.isEqual(current, updated)) return

  //   await this.store.put(key, updated)

  //   // await this.store.update(key, {
  //   //   UpdateExpression: 'ADD #value :rlink',
  //   //   ExpressionAttributeNames: {
  //   //     '#value': 'value'
  //   //   },
  //   //   ExpressionAttributeValues: {
  //   //     ':rlink': buildResource.id(resource)
  //   //   },
  //   //   ConditionExpression: 'NOT contains(#value, :rlink)'
  //   // })
  // }

  // public getBacklink = async (opts: ResourceProperty):Promise<Backlink> => {
  //   return await this.store.get(getBacklinkKey(opts))
  // }
}

export const getBacklinkKeyFromStub = (stub: ResourceStub) => {
  return getBacklinkKey(getLatestVersionId(parseStub(stub)))
}

export const getBacklinkKey = (versionId: string) => versionId

// export const getBacklinkKey = ({ type, permalink, property }: ResourceProperty) => {
//   return `${type}_${permalink}.${property}`
// }

export const getForwardLinks = ({ models, resource }: {
  models: Models
  resource: ITradleObject
}):ForwardLink[] => {
  const type = resource[TYPE]
  const model = models[type]
  if (!model) throw new Errors.InvalidInput(`missing model: ${type}`)

  const sourceStub = buildResource.stub({ models, resource })
  const { properties } = model
  return Object.keys(resource)
    .map(linkPropertyName => {
      const property = properties[linkPropertyName]
      if (!property || isInlinedProperty({ models, property })) {
        return
      }

      const { ref } = property
      if (!ref) return

      const targetStub = resource[linkPropertyName]
      if (!targetStub) return

      const targetParsedStub = parseStub(targetStub)
      const { type } = targetParsedStub
      const targetModel = models[type]
      const backlinkPropertyName = getBacklinkForForwardLink({
        models,
        sourceModel: model,
        targetModel,
        linkPropertyName: linkPropertyName
      })

      if (!backlinkPropertyName) return

      const sourceParsedStub = parseStub(sourceStub)
      return {
        source: resource,
        sourceStub,
        sourceParsedStub,
        sourceVersionId: getLatestVersionId(sourceParsedStub),
        forward: linkPropertyName,
        targetModel,
        back: backlinkPropertyName,
        targetStub,
        targetParsedStub,
        targetVersionId: getLatestVersionId(targetParsedStub)
      }
    })
    .filter(_.identity)
    // .reduce((byProp, value) => {
    //   byProp[value.forward] = value
    //   return byProp
    // }, {})
}

export const getBacklinkForForwardLink = ({
  models,
  sourceModel,
  targetModel,
  linkPropertyName
}: {
  models: Models
  // e.g.
  //   sourceModel: tradle.Verification
  //   targetModel: tradle.PhotoID
  //   linkPropertyName: "document"
  sourceModel: Model
  targetModel: Model
  linkPropertyName: string
}) => {
  const targetModels = [targetModel].concat(getAncestors({ models, model: targetModel }))

  let prop
  const model = targetModels.find(targetModel => {
    const { properties } = targetModel
    prop = Object.keys(properties).find(propertyName => {
      const property = properties[propertyName]
      const { items } = property
      if (!items) return

      const { ref, backlink } = items
      if (backlink !== linkPropertyName) return

      if (ref === sourceModel.id) return true

      // e.g. a forms backlink might have ref "tradle.Form"
      // forward link might be "tradle.PhotoID"
      // check: is tradle.PhotoID a descendant of tradle.Form?
      return isDescendantOf({ models, a: sourceModel.id, b: ref })
    })

    return !!prop
  })

  return prop
}

const getAncestors = ({ models, model }) => {
  let cur = model
  const ancestors = []
  while (cur.subClassOf) {
    let parent = models[cur.subClassOf]
    ancestors.push(parent)
    cur = parent
  }

  return ancestors
}

// const updateBacklink = (ids:Backlink, id:string):Backlink => {
//   const stubs = ids.map(parseId)
//   const update = parseId(id)
//   const idx = stubs.findIndex(stub => stub.permalink === update.permalink)
//   if (idx === -1) {
//     return ids.concat(id)
//   }

//   if (stubs[idx].link === update.link) return ids

//   return ids.map((oldId, i) => i === idx ? id : oldId)
// }

export const toBacklinks = (forwardLinks: ForwardLink[]):BacklinksContainer[] => {
  const byTargetId = _.groupBy(forwardLinks, f => f.targetVersionId)
  return Object.keys(byTargetId).map(vId => {
    const backlinks = {}
    const byBacklinkProp = _.groupBy(byTargetId[vId], 'back')
    for (let backlinkProp in byBacklinkProp) {
      let backlink = backlinks[backlinkProp] = {}
      let fLinks = byBacklinkProp[backlinkProp]
      for (const fl of fLinks) {
        backlink[fl.sourceVersionId] = fl.sourceParsedStub.link
      }
    }

    return {
      // forwardLinks: byTargetId[vId],
      targetId: vId,
      backlinks
    }
  })
}

// export const mergeBacklinkChanges = (backlinks:BacklinksContainer[]):BacklinksContainers => {
//   return _.transform(_.groupBy(backlinks, 'targetId'), (byTargetId, blsForTarget, targetId) => {
//     byTargetId[targetId] = {
//       targetId,
//       backlinks: blsForTarget.reduce((res, bl) => _.extend(res, bl.backlinks), {})
//     }
//   }, {})
// }

export const mergeBacklinkChanges = (backlinks:BacklinksContainer[]):BacklinksContainer => {
  const targetId = backlinks[0].targetId
  const allSameTarget = backlinks.every(b => b.targetId === targetId)
  if (!allSameTarget) {
    throw new Errors.InvalidInput('expected same "targetId" for all')
  }

  return {
    targetId,
    backlinks: backlinks.reduce((merged, next) => {
      return _.extend(merged, next.backlinks)
    }, {})

      // .reduce((merged, { backlinks }) => mergeBacklink(merged, backlinks), {})
  }
}

// const mergeWithArrayConcat =  (objValue=[], srcValue=[]) => objValue.concat(srcValue)
// const mergeBacklink = (a, b) => _.mergeWith(a, b, mergeWithArrayConcat)

export const getBacklinkChanges = ({ before, after }: {
  before?: BacklinksContainer
  after?: BacklinksContainer
}):BacklinksChange => {
  if (!(before || after)) {
    throw new Errors.InvalidInput('expected "before" and/or "after"')
  }

  const { targetId } = before || after
  const set:StoredResourceBacklinks = {}
  const remove:RemoveBacklinks = {}
  concatKeysUniq(
    before && before.backlinks,
    after && after.backlinks
  ).forEach(backlink => {
    const toSet = {}
    const toRemove = []
    const pre = before && before.backlinks[backlink]
    const post = after && after.backlinks[backlink]
    if (pre && post) {
      concatKeysUniq(pre, post).forEach(latestId => {
        if (post[latestId] === pre[latestId]) return
        if (post[latestId]) {
          if (post[latestId] !== pre[latestId]) {
            toSet[latestId] = post[latestId]
          }
        } else {
          toRemove.push(latestId)
        }
      })
    } else if (pre) {
      toRemove.push(...Object.keys(pre))
    } else if (post) {
      _.extend(toSet, post)
    }

    if (!_.isEmpty(toSet)) set[backlink] = toSet
    if (!_.isEmpty(toRemove)) remove[backlink] = toRemove
  })

  if (_.isEmpty(set) && _.isEmpty(remove)) return

  return {
    targetId,
    set,
    remove
  }
}

const removeBacklinksToPaths = (backlinks: RemoveBacklinks):string[][] => {
  const paths = []
  Object.keys(backlinks).map(backlink => {
    const path = backlinks[backlink].map(latestId => [backlink, latestId])
    paths.push(path)
  })

  return _.flatten(paths)
}

const concatKeysUniq = (...objs): string[] => {
  const keyMap = {}
  for (const obj of objs) {
    if (obj) {
      for (let key in obj) keyMap[key] = true
    }
  }

  return Object.keys(keyMap)
}

export const getLatestVersionId = ({ type, permalink }: {
  type: string
  permalink: string
}) => `${type}_${permalink}`

export const getUpdateForBacklinkChange = ({ targetId, set, remove }: BacklinksChange) => ({
  key: getBacklinkKey(targetId),
  set: _.isEmpty(set) ? null : toPathValuePairs(set),
  unset: _.isEmpty(remove) ? null : removeBacklinksToPaths(remove)
})

export const getBacklinkChangesForChanges = ({ models, changes }: {
  models: Models
  changes: ISaveEventPayload[]
}) => {
  const forwardBefore = _.flatMap(changes, ({ value, old }) => {
    return old ? getForwardLinks({ models, resource: old }) : []
  })

  const forwardAfter = _.flatMap(changes, ({ value, old }) => {
    return value ? getForwardLinks({ models, resource: value }) : []
  })

  const backlinksBefore = toBacklinks(forwardBefore)
  const backlinksAfter = toBacklinks(forwardAfter)
  const beforeByTarget = _.groupBy(backlinksBefore, 'targetId')
  const afterByTarget = _.groupBy(backlinksAfter, 'targetId')
  return concatKeysUniq(beforeByTarget, afterByTarget)
    .map(targetId => {
      const before = beforeByTarget[targetId] && mergeBacklinkChanges(beforeByTarget[targetId])
      const after = afterByTarget[targetId] && mergeBacklinkChanges(afterByTarget[targetId])
      const result = getBacklinkChanges({ before, after })
      if (!result) return

      const isNew = _.isEmpty(result.remove) && forwardBefore.concat(forwardAfter).some(fl => {
        const { link, permalink } = fl.targetParsedStub
        return link !== permalink
      })

      return {
        ...result,
        isNew
      }
    })
    .filter(_.identity)
}

export { Backlinks }
export const createBacklinks = (opts: BacklinksOpts) => new Backlinks(opts)

export const exportBacklinksContainer = (backlinks: StoredResourceBacklinks):ResourceBacklinks => {
  return _.transform(backlinks, (result, backlink, key) => {
    result[key] = Object.keys(backlink).map(versionId => ({
      id: toId({ versionId, link: backlink[versionId] })
    }))
  }, {})
}

const toId = ({ versionId, link }) => `${versionId}_${link}`

// MAP:
//   [
//     {
//       _permalink: 'aaa',
//       _link: 'bbb',
//       _t: 'tradle.Verification',
//       documentOwner: {
//         id: 'tradle.Identity_ccc'
//       },
//       document: {
//         id: 'tradle.PhotoID_ddd'
//       }
//     },
//   ]

//   =>


//   tradle.PhotoID_ddd: {
//     verifications: {
//       'tradle.Verification_aaa': 'bbb',
//     }
//   }

//   user_ccc: {
//     verifications: {
//       'tradle.Verification_aaa': 'bbb',
//     }
//   }

// REDUCE:
//   collapse changes per target resource
