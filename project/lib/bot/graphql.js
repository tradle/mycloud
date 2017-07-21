const debug = require('debug')('tradle:sls:graphql')
const { graphql } = require('graphql')
// const express = require('express')
// const expressGraphQL = require('express-graphql')
// const compression = require('compression')
// const awsServerlessExpress = require('aws-serverless-express')
// const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware')
const {
  constants,
  createTables,
  createResolvers
} = require('@tradle/dynamodb')

const { createSchema } = require('@tradle/schema-graphql')
const { co } = require('../utils')

module.exports = function setup ({ table, models, objects, prefix }) {
  // const app = express()
  // app.use(compression())
  // app.use('/', expressGraphQL(() => ({
  //   schema: getSchema(),
  //   graphiql: true
  // })))

  // app.use(awsServerlessExpressMiddleware.eventContext())
  // const server = awsServerlessExpress.createServer(app)
  // const handleHTTPRequest = (event, context) => {
  //   return awsServerlessExpress.proxy(server, event, context)
  // }

  const tables = createTables({ models, objects, prefix })
  const resolvers = createResolvers({
    objects,
    models,
    tables
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
    return graphql(getSchema(), query, null, {}, variables)
  }

  const handleHTTPRequest = co(function* (event) {
    debug(`received GraphQL query: ${event.body}`)
    try {
      const { query, variables } = JSON.parse(event.body)
      return yield executeQuery(query, variables)
    } catch (err) {
      throw new Error(err.message)
    }
  })

  return {
    tables,
    resolvers,
    // executeQuery,
    handleHTTPRequest
  }
}
