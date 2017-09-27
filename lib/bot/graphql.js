const debug = require('debug')('tradle:sls:graphql')
const { graphql, formatError } = require('graphql')
const expressGraphQL = require('express-graphql')
const dynogels = require('dynogels')
const { createResolvers } = require('@tradle/dynamodb')
const { createSchema } = require('@tradle/schema-graphql')
const { TYPE, TYPES } = require('@tradle/constants')
const { MESSAGE } = TYPES
const { co, extend } = require('../utils')
const { docClient } = require('../aws')

dynogels.log = {
  info: require('debug')('dynogels:info'),
  warn: require('debug')('dynogels:warn'),
  level: 'warn'
}

const { NODE_ENV } = process.env
const TESTING = process.env.NODE_ENV === 'test'

module.exports = function setup (opts) {
  const { router, models, objects, db, presignUrls } = opts
  debug('attaching /graphql route')
  router.use('/graphql', expressGraphQL(() => ({
    schema: getSchema(),
    graphiql: true,
    formatError: err => {
      console.error('experienced error executing GraphQL query', err.stack)
      return formatError(err)
    }
  })))

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
    executeQuery
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
