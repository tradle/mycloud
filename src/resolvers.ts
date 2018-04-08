import { difference, defaultsDeep } from 'lodash'
import { TYPE } from '@tradle/constants'

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

import { ParsedResourceStub, Backlinks } from './types'
import { parseStub, allSettled } from './utils'

const {
  resultsToJson
} = utils

type PropertyInfo = {
  propertyName: string
  model: Model
}

type BacklinkInfo = {
  target: ParsedResourceStub
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

    const parsedStubs = results.map(parseStub)
    if (select && !difference(select, PROPS_KNOWN_FROM_STUB).length) {
      return parsedStubs.map(({ type, link, permalink }) => ({
        [TYPE]: type,
        _link: link,
        _permalink: permalink
      }))
    }

    return (await allSettled(parsedStubs.map(({ link }) => objects.get(link))))
      .filter(r => r.isFulfilled)
      .map(r => r.value)
  }

  const listBacklink = async (opts: ListOpts) => {
    const { backlink, filter } = opts
    const container = await backlinks.getBacklinks(backlink.target)
    const { model, propertyName } = backlink.back
    const results = container[propertyName]
    const items = results ? await normalizeBacklinkResults({ ...opts, results }) : []
    const property = model.properties[propertyName]
    return {
      items: filterResults({
        models,
        filter: defaultsDeep(filter || {}, property.items.filter || {}),
        results: items
      })
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
