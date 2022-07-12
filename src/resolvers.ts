import _ from 'lodash'
import { difference, defaultsDeep } from 'lodash'
import { TYPE, TYPES } from '@tradle/constants'
const {
  IDENTITY
} = TYPES
import {
  Model,
  Models,
  Objects,
  Filter,
  OrderBy,
  DB,
  filterResults,
  utils as dynamoUtils
} from '@tradle/dynamodb'

import validateModels from '@tradle/validate-model'
import validateResource from '@tradle/validate-resource'
import { ResourceStub, Backlinks, Identities } from './types'
import { allSettled } from './utils'
import Errors from './errors'
import { toStreamItems } from './test/utils'

const { getRef, isDescendantOf } = validateModels.utils
const { isInstantiable } = validateResource.utils
const SHARE_REQUEST = 'tradle.ShareRequest'
const BOOKMARK = 'tradle.Bookmark'
import { TYPES as LOCAL_TYPES } from './in-house-bot/constants'
const { 
  MY_EMPLOYEE_ONBOARDING 
} = LOCAL_TYPES
const EXCLUDED_TYPES = [
  'tradle.PubKey',
  IDENTITY,
  // 'tradle.credit.CostOfCapital'
]
type PropertyInfo = {
  propertyName: string
  model: Model
}

type BacklinkInfo = {
  target: ResourceStub
  forward: PropertyInfo
  back: PropertyInfo
}

type ListOpts = {
  model: Model
  select?: string[]
  filter?: Filter,
  orderBy?: OrderBy,
  limit?: number
  checkpoint?: any
  context?: any
  backlink?: BacklinkInfo
}

const PROPS_KNOWN_FROM_STUB = [TYPE, '_link', '_permalink']

export const createResolvers = ({ db, backlinks, objects, identities, models, postProcess }: {
  db: DB
  models: Models
  objects: Objects
  identities: Identities
  backlinks?: Backlinks
  postProcess?: Function
}) => {

  const MESSAGE_PROPS = Object.keys(models['tradle.Message'].properties)
  const update = db.update
  const put = db.put
  const getByLink = ({ model, link }) => {
    // if (model) {
    //   if (model.id === 'tradle.Message') {
    //     return db.findOne({
    //       filter: {
    //         EQ: {
    //           [TYPE]: model.id,
    //           _link: link
    //         }
    //       }
    //     })
    //   }
    // }

    return objects.get(link)
  }

  const get = async ({ model, key, context }: { model: Model, key: any, context: any }) => {
    // identities are a special case, as tradle.Identity in db might not
    // have same level of validation as PubKey mappings in identities module
    if (model.id === 'tradle.Identity' && key._permalink && !key._link) {
      return identities.byPermalink(key._permalink)
    }

    try {
      let resource = await db.get({
        [TYPE]: model.id,
        ...key
      })
      if (EXCLUDED_TYPES.indexOf(model.id) === -1) {
        let { counterparty } = context
        if (counterparty) {
          if (!resource._authorOrg || resource._authorOrg !== counterparty._permalink)
            throw new Error('User does not have rights to see this resource')
        }
      }
      return resource
      // result = await db.findOne({
      //   filter: {
      //     EQ: {
      //       [TYPE]: model.id,
      //       ...key
      //     }
      //   }
      // })
    } catch (err) {
      if (err.name && err.name.toLowerCase() === 'notfound') {
        return null
      }

      throw err
    }
  }

  const normalizeBacklinkResults = async (opts) => {
    const { select, results } = opts
    if (!(results && results.length)) {
      return []
    }

    const need = dynamoUtils.getDecisionProps(opts)
    const flat = _.flatMap(results, r => Object.keys(r))
    const have = _.uniq(flat)
    if (!difference(need, have).length) {
      return results
    }

    return (await allSettled(results.map(({ _link }) => objects.get(_link))))
      .filter(r => r.isFulfilled)
      .map(r => r.value)
  }

  const listBacklink = async (opts: ListOpts) => {
    const { backlink, context, ...listOpts } = opts
    const { filter } = listOpts
    // const type = filter[TYPE]
    // const model = models[type]
    // const iner
    // if (model && (model.interfaces.includes())

    const { model, propertyName } = backlink.back
    const property = model.properties[propertyName]
    const ref = getRef(property)
    const refModel = models[ref]
    const propFilter = property.items.filter || {}
    defaultsDeep(filter, propFilter)

    if (context) {
      let counterparty = context.counterparty
      if (counterparty)
        filter.EQ['_authorOrg'] = counterparty._permalink
    }
    const typeCondition = filter.EQ[TYPE]
    if (typeCondition) {
      try {
        ensureInstantiableDescendant(typeCondition, ref)
      } catch (err) {
        Errors.rethrowAs(err, new Errors.InvalidInput(`invalid filter condition for ${TYPE}: ${typeCondition}. ${err.message}`))
      }
    }

    // TODO:
    // do we need this or is this duplicating functionality in Backlinks?
    // one diff is that Backlinks module doesn't support pagination
    if (!backlinks.isBacklinkableModel(refModel)) {
      filter.EQ[TYPE] = ref
      return await list(listOpts)
    }

    if (backlink.target[propertyName]) {
      let promises = backlink.target[propertyName].map(r => db.get(r))
      return {
        items: await Promise.all(promises)
      }
    }
      
    const container = await backlinks.getBacklinks({
      type: backlink.target[TYPE],
      permalink: backlink.target._permalink,
      properties: [propertyName]
    })

    const results = container[propertyName]
    const items = results ? await normalizeBacklinkResults({ ...opts, results }) : []
    return {
      items: filterResults({
        models,
        filter,
        results: items
      })
    }
  }

  // Note: could generate more specific schema instead
  const ensureInstantiableDescendant = (a, b) => {
    const bModel = models[b]
    if (a && a !== b) {
      if (isInstantiable(bModel)) {
        throw new Error(`expected ${b} or its descendant`)
      }

      const model = models[a]
      if (!model) {
        throw new Error(`model not found: ${a}`)
      }

      if (!isInstantiable(model)) {
        throw new Error(`invalid filter condition for ${TYPE}: ${a}. ${a} is not instantiable`)
      }

      if (!isDescendantOf({ models, a, b })) {
        throw new Error(`invalid filter condition for ${TYPE}: ${a}. ${a} is not a descendant of ${b}`)
      }
    }
  }

  const list = async (opts: any) => { // ListOpts) => {
    if (opts.backlink && backlinks) {
      return listBacklink(opts)
    }

    let { model, select, filter, orderBy, limit, checkpoint, context, args } = opts

    let counterparty
    if (EXCLUDED_TYPES.indexOf(model.id) === -1 && opts.context)
      counterparty = opts.context.counterparty

    if (!filter) filter = { EQ: {} }
    if (!filter.EQ) filter.EQ = {}
    filter.EQ[TYPE] = model.id
    
    if (counterparty)  {
      let isAllowed = args.allow === model.id
      if (!isAllowed  &&  model.id === MY_EMPLOYEE_ONBOARDING) {
        isAllowed = true
        if (!filter.EQ || filter.EQ['owner._permalink'] !== context.user.identity._permalink) {
          if (!filter.EQ)
            filter.EQ = {}
          filter.EQ['owner._permalink'] === context.user.identity._permalink
        }
      }
      if (!isAllowed  &&  (!filter.EQ._permalink || filter.EQ._permalink !== counterparty._permalink))
        filter.EQ['_authorOrg'] = counterparty._permalink
    }  
    else if (model.id === BOOKMARK)  {
      if (!filter.NULL)
        filter.NULL = {}
      filter.NULL['_authorOrg'] = true
    }
    const conf = opts.context && opts.context.components && opts.context.components.conf || []
    
    return db.find({
      allowScan: true,
      select,
      filter,
      orderBy,
      limit,
      checkpoint
    })
  }

  const raw = {
    list,
    get,
    getByLink,
    update
  }

  if (!postProcess) return raw

  const wrapped = {}
  for (let op in raw) {
    wrapped[op] = withPostProcess(raw[op], op)
  }

  return wrapped

  function withPostProcess (fn, op) {
    return async (...args) => {
      const result = await fn(...args)
      // Temprorary fix
      if (result[TYPE] === SHARE_REQUEST  ||  (result.items  &&  result.items.length  &&  result.items[0][TYPE] === SHARE_REQUEST)) {
        if (result.items  &&  result.items[0].with[0].id) {
          result.items.forEach(item => {
            item.with = item.with.map(w => {
              let [ _t, _permalink, _link ] = w.id.split('_')
              return {_t, _permalink, _link}
            })            
          })  
        }      
        else if (result.with[0].id) {
          result.with = result.with.map(w => {
            let [ _t, _permalink, _link ] = w.id.split('_')
            return {_t, _permalink, _link}
          })            
        }
      }
      // debugger
      return postProcess(result, op, ...args)
    }
  }
}
