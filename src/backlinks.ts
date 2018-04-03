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
  getPermId,
  RESOLVED_PROMISE
} from './utils'

import {
  ITradleObject,
  ModelStore,
  Models,
  Model,
  Middleware,
  DB,
  ResourceStub,
  ParsedResourceStub,
  ISaveEventPayload,
  Logger
} from './types'

import { getRecordsFromEvent } from './db-utils'
import Errors from './errors'
import { TYPES } from './constants'
const { BACKLINK_ITEM } = TYPES

const { isDescendantOf, isInlinedProperty } = validateResource.utils
const SEPARATOR = ':'

interface ResourceProperty extends ParsedResourceStub {
  property: string
}

export type BacklinkItem = {
  // sourceRes: ITradleObject
  // sourceStub: ResourceStub
  // sourceParsedStub: ParsedResourceStub
  source: string
  sourceLink: string
  // linkProp: string
  backlinkProp: string
  // backlinkModel: Model
  // back: string
  // targetModel: Model
  // targetStub: ResourceStub
  // targetParsedStub: ParsedResourceStub
  target: string
  targetLink: string
}

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
  add: BacklinkItem[]
  del: BacklinkItem[]
}

// export type Backlink = string[]

type BacklinksOpts = {
  db: DB
  modelStore: ModelStore
  logger: Logger
}

export default class Backlinks {
  private db: DB
  private modelStore: ModelStore
  private logger: Logger
  constructor ({ db, modelStore, logger }: BacklinksOpts) {
    this.db = db
    this.modelStore = modelStore
    this.logger = logger
  }

  private get models() {
    return this.modelStore.models
  }

  private getBacklinkItems = (resource):BacklinkItem[] => {
    return getBacklinkItems({ models: this.models, resource })
  }

  public getBacklinks = async ({ type, permalink, properties }: {
    type: string
    permalink: string
    properties?: string[]
  }):Promise<ResourceBacklinks> => {
    const filter = {
      IN: {},
      EQ: {
        [TYPE]: BACKLINK_ITEM,
        target: getPermId({ type, permalink })
      }
    }

    if (properties) {
      filter.IN = {
        backlinkProp: properties
      }
    }

    const { items } = await this.db.find({ filter })
    return toResourceFormat({
      models: this.models,
      backlinkItems: items
    })
  }

  // public processMessages = async (messages: ITradleMessage[]) => {
  //   messages = messages.filter(m => m.context)
  //   if (!messages.length) return

  //   const payloads = messages.map()
  // }

  public processChanges = async (resourceChanges: ISaveEventPayload[]) => {
    const backlinkChanges = this.getBacklinksChanges(resourceChanges)
    const { add, del } = backlinkChanges
    if (add.length) this.logger.debug(`creating ${add.length} backlink items`)
    if (del.length) this.logger.debug(`deleting ${del.length} backlink items`)

    const promiseAdd = add.length ? this.db.batchPut(add) : RESOLVED_PROMISE
    const promiseDel = del.length ? Promise.all(del.map(item => this.db.del(item))) : RESOLVED_PROMISE
    await Promise.all([promiseAdd, promiseDel])
    return backlinkChanges
  }

  public getBacklinksChanges = (rChanges: ISaveEventPayload[]):BacklinksChange => {
    return getBacklinkChangesForChanges({
      models: this.models,
      changes: rChanges
    })
  }
}

export const getBacklinkItems = ({ models, resource }: {
  models: Models
  resource: ITradleObject
}):BacklinkItem[] => {
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
      const backlinkPropertyName = getBacklinkProperty({
        models,
        sourceModel: model,
        targetModel,
        forward: linkPropertyName
      })

      if (!backlinkPropertyName) return

      const sourceParsedStub = parseStub(sourceStub)
      return {
        [TYPE]: BACKLINK_ITEM,
        source: serializeSource({
          type: sourceParsedStub.type,
          permalink: sourceParsedStub.permalink,
          property: linkPropertyName
        }),
        sourceLink: sourceParsedStub.link,
        // sourceRes: resource,
        // sourceStub,
        // sourceParsedStub,
        // linkProp: linkPropertyName,
        backlinkProp: backlinkPropertyName,
        target: getPermId(targetParsedStub),
        targetLink: targetParsedStub.link
        // targetStub,
        // targetParsedStub,
        // targetModel,
      }
    })
    .filter(_.identity)
    // .reduce((byProp, value) => {
    //   byProp[value.forward] = value
    //   return byProp
    // }, {})
}

export const getBacklinkProperty = ({
  models,
  sourceModel,
  targetModel,
  forward
}: {
  models: Models
  // e.g.
  //   sourceModel: tradle.Verification
  //   targetModel: tradle.PhotoID
  //   forward: "document"
  sourceModel: Model
  targetModel: Model
  forward: string
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
      if (backlink !== forward) return

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

// export const toBacklinks = (forwardLinks: BacklinkItem[]):BacklinksContainer[] => {
//   const byTargetId = _.groupBy(forwardLinks, f => f.targetPermId)
//   return Object.keys(byTargetId).map(vId => {
//     const backlinks = {}
//     const byBacklinkProp = _.groupBy(byTargetId[vId], 'back')
//     for (let backlinkProp in byBacklinkProp) {
//       let backlink = backlinks[backlinkProp] = {}
//       let fLinks = byBacklinkProp[backlinkProp]
//       for (const fl of fLinks) {
//         backlink[fl.sourcePermId] = fl.sourceParsedStub.link
//       }
//     }

//     return {
//       // forwardLinks: byTargetId[vId],
//       targetId: vId,
//       backlinks
//     }
//   })
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

// export const getBacklinkChanges = ({ before, after }: {
//   before?: BacklinksContainer
//   after?: BacklinksContainer
// }):BacklinksChange => {
//   if (!(before || after)) {
//     throw new Errors.InvalidInput('expected "before" and/or "after"')
//   }

//   const { targetId } = before || after
//   const set:StoredResourceBacklinks = {}
//   const remove:RemoveBacklinks = {}
//   concatKeysUniq(
//     before && before.backlinks,
//     after && after.backlinks
//   ).forEach(backlink => {
//     const toSet = {}
//     const toRemove = []
//     const pre = before && before.backlinks[backlink]
//     const post = after && after.backlinks[backlink]
//     if (pre && post) {
//       concatKeysUniq(pre, post).forEach(latestId => {
//         if (post[latestId] === pre[latestId]) return
//         if (post[latestId]) {
//           if (post[latestId] !== pre[latestId]) {
//             toSet[latestId] = post[latestId]
//           }
//         } else {
//           toRemove.push(latestId)
//         }
//       })
//     } else if (pre) {
//       toRemove.push(...Object.keys(pre))
//     } else if (post) {
//       _.extend(toSet, post)
//     }

//     if (!_.isEmpty(toSet)) set[backlink] = toSet
//     if (!_.isEmpty(toRemove)) remove[backlink] = toRemove
//   })

//   if (_.isEmpty(set) && _.isEmpty(remove)) return

//   return {
//     targetId,
//     set,
//     remove
//   }
// }

// const removeBacklinksToPaths = (backlinks: RemoveBacklinks):string[][] => {
//   const paths = []
//   Object.keys(backlinks).map(backlink => {
//     const path = backlinks[backlink].map(latestId => [backlink, latestId])
//     paths.push(path)
//   })

//   return _.flatten(paths)
// }

const concatKeysUniq = (...objs): string[] => {
  const keyMap = {}
  for (const obj of objs) {
    if (obj) {
      for (let key in obj) keyMap[key] = true
    }
  }

  return Object.keys(keyMap)
}

export const getBacklinkChangesForChanges = ({ models, changes }: {
  models: Models
  changes: ISaveEventPayload[]
}) => {
  const forwardBefore = _.flatMap(changes, ({ value, old }) => {
    return old ? getBacklinkItems({ models, resource: old }) : []
  })

  const forwardAfter = _.flatMap(changes, ({ value, old }) => {
    return value ? getBacklinkItems({ models, resource: value }) : []
  })

  const fBeforeUids = forwardBefore.map(toUid)
  const fAfterUids = forwardAfter.map(toUid)
  const del = forwardBefore.filter(fl => !fAfterUids.includes(toUid(fl)))
  const add = forwardAfter.filter(fl => !fBeforeUids.includes(toUid(fl)))

  return {
    add,
    del
  }
}

export { Backlinks }
export const createBacklinks = (opts: BacklinksOpts) => new Backlinks(opts)

export const exportBacklinksContainer = (backlinks: StoredResourceBacklinks):ResourceBacklinks => {
  return _.transform(backlinks, (result, backlink, key) => {
    result[key] = Object.keys(backlink).map(permId => ({
      id: toId({ permId, link: backlink[permId] })
    }))
  }, {})
}

const toId = ({ permId, link }) => `${permId}_${link}`
const toUid = (fl:BacklinkItem) => fl.source + fl.target
const toResourceFormat = ({ models, backlinkItems }: {
  models: Models
  backlinkItems: BacklinkItem[]
}):ResourceBacklinks => {
  const byProp = _.groupBy(backlinkItems, 'backlinkProp')
  return _.transform(byProp, (bls, vals, prop) => {
    bls[prop] = vals.map(({ source, sourceLink }) => {
      const parsedSource = parseSource(source)
      const sourcePermId = getPermId(parsedSource)
      return {
        id: `${sourcePermId}_${sourceLink}`
      }
    })
  }, {})
}

const TARGET_REGEX = new RegExp('^(.*)?_([0-9a-fA-F]+)$')
const SOURCE_REGEX = new RegExp('^(.*)?_([0-9a-fA-F]+)' + SEPARATOR + '([^:]+)$')

const parseTarget = target => {
  const [type, permalink] = target.match(TARGET_REGEX).slice(1)
  return { type, permalink }
}

const parseSource = source => {
  const [type, permalink, property] = source.match(SOURCE_REGEX).slice(1)
  return { type, permalink, property }
}

const serializeSource = ({ type, permalink, property }: {
  type: string
  permalink: string
  property: string
}) => {
  return [
    getPermId({ type, permalink }),
    property
  ].join(SEPARATOR)
}

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
