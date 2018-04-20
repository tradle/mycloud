import _ from 'lodash'
import { difference, defaultsDeep } from 'lodash'
import { TYPE } from '@tradle/constants'
import buildResource from '@tradle/build-resource'

import {
  Model,
  Models,
  Objects,
  Filter,
  OrderBy,
  utils,
  DB,
  filterResults
} from '@tradle/dynamodb'

import validateModels from '@tradle/validate-model'
import validateResource from '@tradle/validate-resource'
import { ResourceStub, Backlinks } from './types'
import { parseStub, allSettled } from './utils'

const { getRef, isDescendantOf } = validateModels.utils
const { isInstantiable } = validateResource.utils

const {
  resultsToJson
} = utils

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
  backlink?: BacklinkInfo
}

const PROPS_KNOWN_FROM_STUB = [TYPE, '_link', '_permalink']

export const createResolvers = ({ db, backlinks, objects, models, postProcess }: {
  db: DB
  models: Models
  objects: Objects
  backlinks?: Backlinks
  postProcess?: Function
}) => {

  const update = async ({ model, props }: { model: Model, props }) => {
    const result = await db.update(props)
    return resultsToJson(result)
  }

  const put = async ({ model, props }: { model: Model, props }) => {
    const result = await db.put(props)
    return resultsToJson(result)
  }

  const getByLink = objects && objects.get
  const get = async ({ model, key }: { model: Model, key: any }) => {
    let result
    try {
      result = await db.findOne({
        filter: {
          EQ: {
            [TYPE]: model.id,
            ...key
          }
        }
      })
    } catch (err) {
      if (err.name && err.name.toLowerCase() === 'notfound') {
        return null
      }

      throw err
    }

    return result ? resultsToJson(result) : null
  }

  const normalizeBacklinkResults = async (opts) => {
    const { select, results } = opts
    if (!(results && results.length)) {
      return []
    }

    const props = _.chain(results)
      .flatMap(r => Object.keys(r))
      .uniq()
      .value()

    if (select && !difference(select, props).length) {
      return results.map(({ type, link, permalink }) => ({
        [TYPE]: type,
        _link: link,
        _permalink: permalink
      }))
    }

    return (await allSettled(results.map(({ _link }) => objects.get(_link))))
      .filter(r => r.isFulfilled)
      .map(r => r.value)
  }

  const listBacklink = async (opts: ListOpts) => {
    const { backlink, ...listOpts } = opts
    const { filter } = listOpts
    // const type = filter[TYPE]
    // const model = models[type]
    // const iner
    // if (model && (model.interfaces.includes())

    const { model, propertyName } = backlink.back
    const property = model.properties[propertyName]
    const ref = getRef(property)
    const refModel = models[ref]
    const typeCondition = filter.EQ[TYPE]
    if (typeCondition) {
      try {
        ensureInstantiableDescendant(typeCondition, ref)
      } catch (err) {
        throw new Error(`invalid filter condition for ${TYPE}: ${typeCondition}. ${err.message}`)
      }
    }

    if (isInstantiable(refModel)) {
      const { interfaces = [] } = refModel
      if (interfaces.includes('tradle.Intersection')) {
        // intersections are pre-indexed
        // so no need to go via tradle.BacklinkItem
        filter.EQ[TYPE] = ref
        return list(listOpts)
      }
    }

    const container = await backlinks.fetchBacklinks({
      type: backlink.target[TYPE],
      permalink: backlink.target._permalink
    })

    const results = container[propertyName]
    const items = results ? await normalizeBacklinkResults({ ...opts, results }) : []
    return {
      items: filterResults({
        models,
        filter: defaultsDeep(filter || {}, property.items.filter || {}),
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

  const list = async (opts: ListOpts) => {
    if (opts.backlink && backlinks) {
      return listBacklink(opts)
    }

    let { model, select, filter, orderBy, limit, checkpoint } = opts

    if (!filter) filter = { EQ: {} }
    if (!filter.EQ) filter.EQ = {}
    filter.EQ[TYPE] = model.id

    return db.find({
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
      return postProcess(result, op, ...args)
    }
  }
}
