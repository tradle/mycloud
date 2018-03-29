import { difference } from 'lodash'
import { TYPE } from '@tradle/constants'
import {
  utils,
  DB
} from '@tradle/dynamodb'

const {
  resultsToJson
} = utils

import {
  Model,
  Models,
  Objects,
  Filter,
  OrderBy
} from '@tradle/dynamodb'

import { ParsedResourceStub, Backlinks } from './types'
import { parseStub, allSettled } from './utils'

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

const STUB_PROPS = [TYPE, '_link', '_permalink']

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
      result = await db.get(key)
    } catch (err) {
      if (err.name && err.name.toLowerCase() === 'notfound') {
        return null
      }

      throw err
    }

    return result ? resultsToJson(result) : null
  }

  const listBacklink = async (opts: ListOpts) => {
    const { backlink } = opts
    const container = await backlinks.getBacklinks(backlink.target)
    const values = container[backlink.forward.propertyName]
    if (!(values && values.length)) {
      return {
        items: []
      }
    }

    const { select } = opts
    const parsedStubs = values.map(parseStub)
    if (select && !difference(select, STUB_PROPS).length) {
      return {
        items: parsedStubs.map(({ type, link, permalink }) => ({
          [TYPE]: type,
          _link: link,
          _permalink: permalink
        }))
      }
    }

    // return {
    //   items: values
    // }

    const results = await allSettled(parsedStubs.map(({ link }) => objects.get(link)))
    return {
      items: results
        .filter(r => r.isFulfilled)
        .map(r => r.value)
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
