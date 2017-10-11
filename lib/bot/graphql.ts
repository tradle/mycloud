import * as coexpress from 'co-express'
import { graphql, formatError } from 'graphql'
import * as expressGraphQL from 'express-graphql'
import * as dynogels from 'dynogels'
import { createResolvers } from '@tradle/dynamodb'
import { createSchema } from '@tradle/schema-graphql'
import { TYPE, TYPES } from '@tradle/constants'
const { MESSAGE } = TYPES

dynogels.log = {
  info: require('debug')('dynogels:info'),
  warn: require('debug')('dynogels:warn'),
  level: 'warn'
}

export = function setup (opts) {
  const {
    env,
    router,
    models,
    objects,
    db,
  } = opts

  const { debug } = env
  debug('attaching /graphql route')

  let auth
  const setAuth = authImpl => auth = authImpl

  router.use('/graphql', coexpress(function* (req, res, next) {
    if (auth) {
      yield auth(req, res, next)
    } else {
      next()
    }
  }))

  router.use('/graphql', expressGraphQL(() => ({
    schema: getSchema(),
    graphiql: true,
    formatError: err => {
      console.error('experienced error executing GraphQL query', err.stack)
      return formatError(err)
    }
  })))

  router.use(router.defaultErrorHandler)

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

  const loadPayloads = async (messages) => {
    messages = [].concat(messages)
    const payloads = await Promise.all(messages.map(
      msg => objects.getObjectByLink(msg.object._link)
    ))

    payloads.forEach((payload, i) => {
      const neutered = messages[i].object
      const virtual = (neutered._virtual || []).concat(payload._virtual || [])
      Object.assign(neutered, payload)
      neutered._virtual = virtual
    })
  }

  return {
    get schema () {
      return getSchema()
    },
    db,
    resolvers,
    executeQuery,
    setAuth
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
