import express = require('express')
import bodyParser = require('body-parser')
import cors = require('cors')
import helmet = require('helmet')
import coexpress = require('co-express')
import { graphql, formatError } from 'graphql'
import { print } from 'graphql/language/printer'
import { parse } from 'graphql/language/parser'
import expressGraphQL = require('express-graphql')
import dynogels = require('dynogels')
import { createResolvers } from '@tradle/dynamodb'
import { createSchema } from '@tradle/schema-graphql'
import { TYPE, TYPES } from '@tradle/constants'
import { uniqueStrict } from '../utils'

const { MESSAGE } = TYPES
const prettifyQuery = query => print(parse(query))

dynogels.log = {
  info: require('debug')('dynogels:info'),
  warn: require('debug')('dynogels:warn'),
  level: 'warn'
}

export function setupGraphQL (bot) {
  let {
    logger,
    router,
    objects,
    models,
    db,
    promiseReady
  } = bot

  // allow models to be set asynchronously
  logger.debug('attaching /graphql route')

  let auth
  let graphiqlOptions = {}
  const setAuth = authImpl => auth = authImpl
  const setGraphiqlOptions = options => graphiqlOptions = options

  const gqlRouter = express.Router()
  gqlRouter.use(cors())
  gqlRouter.use(helmet())
  gqlRouter.use(bodyParser.json({ limit: '10mb' }))
  gqlRouter.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  gqlRouter.use('/', coexpress(function* (req, res, next) {
    yield promiseReady()
    if (auth) {
      yield auth(req, res, next)
    } else {
      next()
    }
  }))

  gqlRouter.use('/', expressGraphQL(async (req) => {
    await promiseReady()
    const { query } = req.body
    if (query && query.indexOf('query IntrospectionQuery') === -1) {
      logger.debug('received query:')
      logger.debug(prettifyQuery(req.body.query))
    }

    return {
      schema: getSchema(),
      graphiql: graphiqlOptions,
      formatError: err => {
        console.error('experienced error executing GraphQL query', err.stack)
        return formatError(err)
      }
    }
  }))

  gqlRouter.use(router.defaultErrorHandler)
  router.use('/graphql', gqlRouter)

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
    await promiseReady()
    return graphql(getSchema(), query, null, {}, variables)
  }

  const loadPayloads = async (messages) => {
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
  }

  const setModels = (_models) => {
    models = _models
    schema = null
  }

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
    executeQuery,
    setAuth,
    setGraphiqlOptions
  }

  function presignEmbeddedMediaLinks (items) {
    if (!items) return items

    ;[].concat(items).forEach(object => {
      objects.presignEmbeddedMediaLinks({
        object,
        stripEmbedPrefix: true
      })
    })

    return items
  }
}
