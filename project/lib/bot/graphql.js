const { graphql } = require('graphql')
const {
  constants,
  createTables,
  createResolvers
} = require('@tradle/dynamodb')

const { createSchema } = require('@tradle/schema-graphql')
const { co } = require('../utils')

module.exports = function setup ({ table, models, objects }) {
  const tables = createTables({ models, objects })
  const resolvers = createResolvers({
    objects,
    models,
    tables
  })

  const { schema, schemas } = createSchema({ models, objects, resolvers })

  const executeQuery = function executeQuery (query, variables) {
    return graphql(schema, query, null, {}, variables)
  }

  const handleHTTPRequest = co(function* (event) {
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
    schema,
    schemas,
    executeQuery,
    handleHTTPRequest
  }
}
