// @ts-ignore
import Promise = require('bluebird')
import { graphql, introspectionQuery, buildClientSchema } from 'graphql'
import { print } from 'graphql/language/printer'
import { parse } from 'graphql/language/parser'
import { TYPE, TYPES } from '@tradle/constants'
import { createSchema } from '@tradle/schema-graphql'
import { createResolvers } from '@tradle/dynamodb'
import { uniqueStrict } from '../utils'

const { MESSAGE } = TYPES

export const prettifyQuery = query => print(parse(query))

export const getGraphqlAPI = (opts) => {
  const { bot, logger } = opts
  let {
    objects,
    modelStore,
    db
  } = bot

  let models
  const postProcess = async (result, op, opts:any={}) => {
    if (!result) return result

    if (Array.isArray(result) && !result.length) {
      return result
    }

    const { select=[] } = opts
    switch (op) {
    case 'get':
    case 'getByLink':
      if (result[TYPE] === MESSAGE && select.includes('object')) {
        await loadPayloads(result)
      }

      presignEmbeddedMediaLinks(result)
      break
    case 'list':
      if (result.items && result.items.length) {
        if (result.items[0][TYPE] === MESSAGE && select.includes('object')) {
          await loadPayloads(result.items)
        }
      }

      result.items = presignEmbeddedMediaLinks(result.items)
      break
    default:
      break
    }

    return result
  }

  // be lazy
  let resolvers
  let schema
  const getSchema = (() => {
    return () => {
      if (!schema) {
        resolvers = createResolvers({
          objects,
          models,
          db,
          postProcess
        })

        schema = createSchema({ models, objects, resolvers }).schema
      }

      return schema
    }
  })()

  const executeQuery = async (query, variables?) => {
    await bot.promiseReady()
    return graphql(getSchema(), query, null, {}, variables)
  }

  const loadPayloads = async (messages) => {
    const now = Date.now()
    messages = [].concat(messages)

    // maybe better just pre-sign urls
    const payloads = await Promise.map(messages, msg => objects.get(msg.object._link))
    payloads.forEach((payload, i) => {
      const neutered = messages[i].object
      const virtual = uniqueStrict((neutered._virtual || []).concat(payload._virtual || []))
      Object.assign(neutered, payload)
      neutered._virtual = virtual
    })

    const time = Date.now() - now
    logger.debug(`loading message payloads took: ${time}ms`)
  }

  const presignEmbeddedMediaLinks = (items) => {
    if (!items) return items

    ;[].concat(items).forEach(object => {
      objects.presignEmbeddedMediaLinks({
        object,
        stripEmbedPrefix: true
      })
    })

    return items
  }

  const setModels = (_models) => {
    models = _models
    schema = getSchema()
  }

  if (modelStore.cumulativeModelsPack) {
    setModels(modelStore.models)
  }

  modelStore.on('update:cumulative', () => setModels(modelStore.models))

  return {
    setModels,
    get schema () {
      return getSchema()
    },
    exportSchema: () => schemaToJSON(getSchema()),
    get resolvers() {
      getSchema()
      return resolvers
    },
    db,
    executeQuery
  }
}

export const importSchema = buildClientSchema

export const exportSchema = async ({ models }) => {
  const { schema } = createSchema({ models })
  return await schemaToJSON(schema)
}

export const schemaToJSON = async (schema) => {
  const { data } = await graphql(schema, introspectionQuery)
  return data
}
