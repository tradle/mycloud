const debug = require('debug')('tradle:sls:graphql')
const { graphql } = require('graphql')
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
const { co } = require('../utils')
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
  const { models, objects, tables } = opts
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
    graphiql: true
  })))

  const server = awsServerlessExpress.createServer(app, null, binaryMimeTypes)
  const handleHTTPRequest = (event, context) => {
    awsServerlessExpress.proxy(server, event, context)
  }

  const resolvers = createResolvers({ objects, models, tables })

  // be lazy
  let schema
  const getSchema = () => {
    if (!schema) {
      schema = createSchema({ models, objects, resolvers }).schema
    }

    return schema
  }

  const executeQuery = (query, variables) => {
    return graphql(getSchema(), query, null, {}, variables)
  }

  return {
    tables,
    resolvers,
    executeQuery,
    handleHTTPRequest
  }
}
