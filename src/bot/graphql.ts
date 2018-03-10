// @ts-ignore
import Promise from 'bluebird'
import { graphql, introspectionQuery, buildClientSchema } from 'graphql'
import { print } from 'graphql/language/printer'
import { parse } from 'graphql/language/parser'
import { TYPE, TYPES } from '@tradle/constants'
import { createSchema } from '@tradle/schema-graphql'
import { createResolvers } from '@tradle/dynamodb'
import { uniqueStrict } from '../utils'
import { IGraphqlAPI } from '../types'

const { MESSAGE } = TYPES

export const prettifyQuery = query => print(parse(query))

export const createGraphqlAPI = (opts):IGraphqlAPI => {
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
      presignEmbeddedMediaLinks(result)
      break
    case 'list':
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

  const execute = async (query, variables?) => {
    await bot.promiseReady()
    return graphql(getSchema(), query, null, {}, variables)
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

  logger.debug(`have cumulative models pack: ${!!modelStore.cumulativeModelsPack}`)

  setModels(modelStore.models)
  modelStore.on('update:cumulative', () => {
    logger.debug(`loaded cumulative models pack`)
    setModels(modelStore.models)
  })

  return {
    graphiqlOptions: {},
    get schema () {
      return getSchema()
    },
    exportSchema: () => schemaToJSON(getSchema()),
    get resolvers() {
      getSchema()
      return resolvers
    },
    execute
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
