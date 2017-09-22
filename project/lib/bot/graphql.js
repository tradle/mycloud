const debug = require('debug')('tradle:sls:graphql')
const { graphql, formatError } = require('graphql')
const express = require('express')
const expressGraphQL = require('express-graphql')
const compression = require('compression')
const cors = require('cors')
const bodyParser = require('body-parser')
const awsServerlessExpress = require('aws-serverless-express')
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware')
const dynogels = require('dynogels')
const { createResolvers } = require('@tradle/dynamodb')
const { createSchema } = require('@tradle/schema-graphql')
const { TYPE, TYPES } = require('@tradle/constants')
const { MESSAGE } = TYPES
const { co, extend } = require('../utils')
const { docClient } = require('../aws')
const ENV = require('../env')
const { HTTP_METHODS } = ENV

dynogels.log = {
  info: require('debug')('dynogels:info'),
  warn: require('debug')('dynogels:warn'),
  level: 'warn'
}

const { NODE_ENV } = process.env
const TESTING = process.env.NODE_ENV === 'test'
const binaryMimeTypes = [
  'application/javascript',
  'application/json',
  'application/octet-stream',
  'application/xml',
  'font/eot',
  'font/opentype',
  'font/otf',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'text/comma-separated-values',
  'text/css',
  'text/html',
  'text/javascript',
  'text/plain',
  'text/text',
  'text/xml'
]

module.exports = function setup (opts) {
  const { models, objects, db, presignUrls } = opts
  const app = express()
  app.use(compression())
  app.use(cors())
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(awsServerlessExpressMiddleware.eventContext())
  if (HTTP_METHODS) {
    app.use((req, res, next) => {
      debug(`setting Access-Control-Allow-Methods: ${HTTP_METHODS}`)
      res.header('Access-Control-Allow-Methods', HTTP_METHODS)
      next()
    })
  }

  app.use('/', expressGraphQL(() => ({
    schema: getSchema(),
    graphiql: true,
    formatError: err => {
      console.error('experienced error executing GraphQL query', err.stack)
      return formatError(err)
    }
  })))

  app.use(function (err, req, res, next) {
    console.error(err.stack, err)
    res.status(500).send(`something went wrong, we're looking into it`)
  })

  const server = awsServerlessExpress.createServer(app, null, binaryMimeTypes)
  const handleHTTPRequest = (event, context) => {
    awsServerlessExpress.proxy(server, event, context)
  }

  const postProcess = co(function* (result, op) {
    switch (op) {
    case 'get':
      if (result[TYPE] === MESSAGE) {
        yield loadPayloads(result)
      }

      presignEmbeddedMediaLinks(result)
      break
    case 'list':
      if (result.items && result.items.length) {
        if (result.items[0][TYPE] === MESSAGE) {
          yield loadPayloads(result.items)
        }
      }

      result.items = presignEmbeddedMediaLinks(result.items)
      break
    default:
      break
    }

    return result
  })

  const resolvers = createResolvers({
    objects,
    models,
    db,
    postProcess
  })

  // be lazy
  let schema
  const getSchema = () => {
    if (!schema) {
      schema = createSchema({ models, objects, resolvers }).schema
    }

    return schema
  }

  const executeQuery = (query, variables) => {
    const schema = getSchema()
    return graphql(schema, query, null, {}, variables)
  }

  const loadPayloads = co(function* (messages) {
    messages = [].concat(messages)
    const payloads = yield messages.map(msg => objects.getObjectByLink(msg.object._link))
    payloads.forEach((payload, i) => {
      const neutered = messages[i].object
      const virtual = (neutered._virtual || []).concat(payload._virtual || [])
      extend(neutered, payload)
      neutered._virtual = virtual
    })
  })

  return {
    get schema () {
      return getSchema()
    },
    db,
    resolvers,
    executeQuery,
    handleHTTPRequest
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
