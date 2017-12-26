// import Router = require('koa-router')
import compose = require('koa-compose')
import { graphql, formatError } from 'graphql'
import { print } from 'graphql/language/printer'
import { parse } from 'graphql/language/parser'
import graphqlHTTP = require('koa-graphql')
import { createResolvers } from '@tradle/dynamodb'
import { createSchema } from '@tradle/schema-graphql'
import { TYPE, TYPES } from '@tradle/constants'
import ModelsPack = require('@tradle/models-pack')
import { Level } from '../../logger'
import { uniqueStrict, logResponseBody } from '../../utils'
import { ITradleObject } from '../../types'

const { MESSAGE } = TYPES
const prettifyQuery = query => print(parse(query))

export const createHandler = (opts) => {
  const { bot, logger } = opts

  // allow models to be set asynchronously

  // let auth
  let graphiqlOptions = {}
  let api
  let modelsVersionId:string
  let { models } = bot

  const updateVersionId = (models) => {
    modelsVersionId = ModelsPack.versionId(models)
  }

  bot.promiseReady().then(() => {
    api = getGraphqlAPI(opts)
  })

  if (models) updateVersionId(models)

  bot.on('models', updateVersionId)

  const handler = graphqlHTTP(async (req) => {
    logger.debug(`hit graphql query route, ready: ${bot.isReady()}`)
    await bot.promiseReady()
    const { query, variables } = req.body
    if (query && query.indexOf('query IntrospectionQuery') === -1) {
      logger.debug('received query:')
      logger.debug(prettifyQuery(req.body.query))
    }

    if (variables && variables.modelsVersionId) {
      if (modelsVersionId !== variables.modelsVersionId) {
        throw new Error(`expected models with versionId: ${modelsVersionId}`)
      }
    }

    return {
      get schema() { return api.schema },
      graphiql: graphiqlOptions,
      formatError: err => {
        console.error('experienced error executing GraphQL query', err.stack)
        return formatError(err)
      }
    }
  })

  const middleware = [
    handler
  ]

  if (logger.level >= Level.SILLY) {
    middleware.push(logResponseBody(logger))
  }

  // router.setGraphQLAuth = authImpl => auth = authImpl
  // router.use(cors())
  // router.use(bodyParser({ jsonLimit: '10mb' }))

  // router.use('/graphql', async (ctx, next) => {
  //   logger.debug(`hit graphql auth route, ready: ${bot.isReady()}`)
  //   await bot.promiseReady()
  //   if (auth) {
  //     await auth(ctx, next)
  //   } else {
  //     await next()
  //   }
  // })


  const stack = compose(middleware)
  stack.setGraphiqlOptions = options => graphiqlOptions = options
  stack.getGraphqlAPI = () => getGraphqlAPI(opts)
  return stack
}

export const getGraphqlAPI = (opts) => {
  const { bot, logger } = opts
  let {
    objects,
    models,
    db
  } = bot

  const postProcess = async (result, op) => {
    if (!result) return result

    if (Array.isArray(result) && !result.length) {
      return result
    }

    switch (op) {
    case 'get':
      if (result[TYPE] === MESSAGE) {
        await loadPayloads(result)
      }

      presignEmbeddedMediaLinks(result)
      break
    case 'list':
      if (result.items && result.items.length) {
        if (result.items[0][TYPE] === MESSAGE) {
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

  const executeQuery = async (query, variables) => {
    await bot.promiseReady()
    return graphql(getSchema(), query, null, {}, variables)
  }

  const loadPayloads = async (messages) => {
    const now = Date.now()
    messages = [].concat(messages)

    // maybe better just pre-sign urls
    const payloads = await Promise.all(messages.map(
      msg => objects.get(msg.object._link)
    ))

    payloads.forEach((payload, i) => {
      const neutered = messages[i].object
      const virtual = uniqueStrict((neutered._virtual || []).concat(payload._virtual || []))
      Object.assign(neutered, payload)
      neutered._virtual = virtual
    })

    const time = Date.now() - now
    logger.debug(`loading message payloads took: ${time}ms`)
  }

  const setModels = (_models) => {
    models = _models
    schema = getSchema()
  }

  bot.on('models', setModels)

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

  if (models) setModels(models)

  return {
    setModels,
    get schema () {
      return getSchema()
    },
    get resolvers() {
      getSchema()
      return resolvers
    },
    db,
    executeQuery
  }
}
