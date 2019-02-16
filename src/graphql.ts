// @ts-ignore
import Promise from "bluebird"
import { graphql, introspectionQuery, buildClientSchema } from "graphql"
import { print } from "graphql/language/printer"
import { parse } from "graphql/language/parser"
import { TYPES } from "@tradle/constants"
import { createSchema } from "@tradle/schema-graphql"
// import { createResolvers } from '@tradle/dynamodb'
import { createResolvers } from "./resolvers"
import { Bot, Logger, IGraphqlAPI } from "./types"

const { MESSAGE } = TYPES

export const prettifyQuery = query => print(parse(query))

export const createGraphqlAPI = (opts: { bot: Bot; logger: Logger }): IGraphqlAPI => {
  const { bot, logger } = opts
  const { objects, embeds, modelStore, db } = bot

  let models
  const postProcess = async (result, op, opts:any={}) => {
    if (!result) return result

    if (Array.isArray(result) && !result.length) {
      return result
    }

    const { select=[] } = opts
    switch (op) {
      case "get":
      case "getByLink":
      presignEmbeddedMediaLinks(result)
      break
      case "list":
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
      if (!bot.isReady()) throw new Error("bot is not ready")

      if (!schema) {
        resolvers = createResolvers({
          objects,
          models,
          db,
          identities: bot.identities,
          backlinks: bot.backlinks,
          postProcess
        })

        schema = createSchema({ models, objects, resolvers, validateRequired: false }).schema
      }

      return schema
    }
  })()

  const execute = async (query, variables?) => {
    await bot.promiseReady()
    return graphql(getSchema(), query, null, {}, variables)
  }

  const presignEmbeddedMediaLinks = items => {
    if (!items) return items
    ;[].concat(items).forEach(object => {
      embeds.presignEmbeddedMedia({
        object,
        stripEmbedPrefix: true
      })
    })

    return items
  }

  const setModels = _models => {
    logger.debug("setting models, regenerating schema")
    models = _models
    schema = null
    schema = getSchema()
  }

  bot.promiseReady().then(() => {
    logger.debug(`have cumulative models pack: ${!!modelStore.cumulativeModelsPack}`)
    setModels(modelStore.models)
    modelStore.on("update:cumulative", () => {
      logger.debug(`cumulative models pack was updated`)
      setModels(modelStore.models)
    })
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

export const schemaToJSON = async schema => {
  const { data } = await graphql(schema, introspectionQuery)
  return data
}
