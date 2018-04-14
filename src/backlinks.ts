import _ from 'lodash'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import {
  parseStub,
  parsePermId,
  uniqueStrict,
  pluck,
  toPathValuePairs,
  getPermId,
  getResourceIdentifier,
  RESOLVED_PROMISE,
  isUnsignedType
} from './utils'

import {
  ITradleObject,
  ITradleMessage,
  ModelStore,
  Models,
  Model,
  Middleware,
  DB,
  ResourceStub,
  ParsedResourceStub,
  ISaveEventPayload,
  Logger,
  Provider,
  IBacklinkItem
} from './types'

import { getRecordsFromEvent } from './db-utils'
import { Resource, getForwardLinks, getBacklinkProperties } from './bot/resource'
import Errors from './errors'
import { TYPES } from './constants'
const { MESSAGE, BACKLINK_ITEM } = TYPES
const APPLICATION = 'tradle.Application'
const APPLICATION_SUBMISSION = 'tradle.ApplicationSubmission'
const { isDescendantOf, isInlinedProperty } = validateResource.utils
const SEPARATOR = ':'

interface ResourceProperty extends ParsedResourceStub {
  property: string
}

type KVPairArr = [string, any]

export interface IResolvedBacklinkItem extends IBacklinkItem {
  backlinkProp: string
}

export type LatestToLink = {
  [latestId: string]: string
}

export type ResourceBacklinks = {
  [backlinkProperty: string]: ResourceStub[]
}

export type RemoveBacklinks = {
  [backlinkProperty: string]: string[]
}

export type BacklinksChange = {
  add: IBacklinkItem[]
  del: IBacklinkItem[]
}

// export type Backlink = string[]

type BacklinksOpts = {
  provider: Provider
  db: DB
  modelStore: ModelStore
  logger: Logger
}

export default class Backlinks {
  private db: DB
  private modelStore: ModelStore
  private logger: Logger
  private provider: Provider
  constructor ({ provider, db, modelStore, logger }: BacklinksOpts) {
    this.provider = provider
    this.db = db
    this.modelStore = modelStore
    this.logger = logger
  }

  private get models() {
    return this.modelStore.models
  }

  public getForwardLinks = (resource):IBacklinkItem[] => {
    return getForwardLinks({ models: this.models, resource })
  }

  public fetchBacklinks = async ({ type, permalink, properties }: {
    type: string
    permalink: string
    properties?: string[]
  }):Promise<ResourceBacklinks> => {
    const filter = {
      IN: {},
      EQ: {
        [TYPE]: BACKLINK_ITEM,
        'target._permalink': permalink
      }
    }

    if (properties) {
      const targetModel = this.models[type]
      const sourceProps = properties.map(prop => {
        const { ref, backlink } = targetModel.properties[prop].items
        return backlink
      })

      filter.IN = {
        linkProp: sourceProps
      }
    }

    const { items } = await this.db.find({ filter })
    return toResourceFormat({
      models: this.models,
      backlinkItems: items
    })
  }

  public processMessages = async (messages: ITradleMessage[]) => {
    messages = messages.filter(m => m.context)
    if (!messages.length) return

    const contexts = uniqueStrict(pluck(messages, 'context'))
    const applications = await this._getApplicationsWithContexts(contexts)
    const appByContext = applications.reduce((result, app) => {
      result[app.context] = app
      return result
    }, {})

    const submissions = messages.map(m => m.object)
    const applicationSubmissions = submissions.map((submission, i) => {
      const { context } = messages[i]
      const application = appByContext[context]
      if (!application) {
        this.logger.debug('application with context not found', { context })
        return
      }

      return buildResource({
          models: this.models,
          model: APPLICATION_SUBMISSION
        })
        .set({
          application,
          submission,
          context
        })
        .setVirtual({
          _time: submission._time
        })
        .toJSON()
    })
    .filter(_.identity)

    if (!applicationSubmissions.length) return []

    return await Promise.all(applicationSubmissions.map(async (object) => {
      object = await this.provider.signObject({ object })
      return await this.provider.saveObject({ object })
    }))
  }

  public processChanges = async (resourceChanges: ISaveEventPayload[]) => {
    const backlinkChanges = this.getBacklinksChanges(resourceChanges)
    const { add, del } = backlinkChanges
    if (!(add.length || del.length)) return backlinkChanges

    if (add.length) this.logger.debug(`creating ${add.length} backlink items`)//, pluck(add, 'source'))
    if (del.length) this.logger.debug(`deleting ${del.length} backlink items`)//, pluck(del, 'source'))

    const promiseAdd = add.length ? this.db.batchPut(add.map(this.toDBFormat)) : RESOLVED_PROMISE
    const promiseDel = del.length ? Promise.all(del.map(item => this.db.del(item))) : RESOLVED_PROMISE
    await Promise.all([promiseAdd, promiseDel])
    return backlinkChanges
  }

  private toDBFormat = (blItem:IBacklinkItem):any => _.omit(blItem, ['targetParsedStub', 'backlinkProp'])
  private fromDBFormat = (blItem:any):IBacklinkItem => ({
    ...blItem,
    targetParsedStub: {
      ...parsePermId(blItem.target),
      link: blItem.targetLink
    }
  })

  public getBacklinksChanges = (rChanges: ISaveEventPayload[]):BacklinksChange => {
    return getBacklinkChangesForChanges({
      models: this.models,
      changes: rChanges
    })
  }

  private _getPayload = async (message:ITradleMessage) => {
    return await this.db.get(message._payloadLink)
  }

  private _getApplicationsWithContexts = async (contexts:string[]) => {
    const { items } = await this.db.find({
      // select: ['_link', '_permalink', 'context'],
      filter: {
        EQ: {
          [TYPE]: APPLICATION
        },
        IN: {
          context: contexts
        }
      }
    })

    return items
  }
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

// export const toBacklinks = (forwardLinks: IBacklinkItem[]):BacklinksContainer[] => {
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
    return old ? getForwardLinks({ models, resource: old }) : []
  })

  const forwardAfter = _.flatMap(changes, ({ value, old }) => {
    return value ? getForwardLinks({ models, resource: value }) : []
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

const toId = ({ permId, link }) => `${permId}_${link}`
const toUid = (fl:IBacklinkItem) => fl.source._permalink + fl.target._permalink
const toResourceFormat = ({ models, backlinkItems }: {
  models: Models
  backlinkItems: IBacklinkItem[]
}):ResourceBacklinks => {
  const resolved = <KVPairArr>_.flatMap(backlinkItems, bl => {
    const { linkProp, source, target } = bl
    const sourceModel = models[source._t]
    const targetModel = models[target._t]
    const backlinkProps = getBacklinkProperties({
      models,
      sourceModel,
      targetModel,
      linkProp
    })

    return backlinkProps.map(backlinkProp => [backlinkProp, source])
  })

  return resolved.reduce((backlinks, [backlinkProp, value]) => {
    if (!backlinks[backlinkProp]) {
      backlinks[backlinkProp] = []
    }

    backlinks[backlinkProp].push(value)
    return backlinks
  }, <ResourceBacklinks>{})
}

const TARGET_REGEX = new RegExp('^(.*)?_([0-9a-fA-F]+)$')
const SOURCE_REGEX = new RegExp(`^([^${SEPARATOR}]+)${SEPARATOR}(.*)?_([0-9a-fA-F]+)`)

export const parseTarget = target => {
  const [type, permalink] = target.match(TARGET_REGEX).slice(1)
  return { type, permalink }
}

export const parseSource = source => {
  const [property, type, permalink] = source.match(SOURCE_REGEX).slice(1)
  return { type, permalink, property }
}

export const serializeSource = ({ type, permalink, property }: {
  type: string
  permalink: string
  property: string
}) => {
  return [
    property,
    getPermId({ type, permalink })
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
