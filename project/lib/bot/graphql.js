const debug = require('debug')('tradle:sls:graphql')
const { graphql } = require('graphql')
const {
  constants,
  createTables,
  createResolvers
} = require('@tradle/dynamodb')

const { createSchema } = require('@tradle/schema-graphql')
const { co } = require('../utils')

module.exports = function setup ({ table, models, objects, prefix }) {
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
    executeQuery,
    handleHTTPRequest
  }
}
