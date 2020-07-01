import compose from 'koa-compose'
import cors from 'kcors'
import { get, pick, once } from 'lodash'
import { parse as parseQuery } from 'graphql/language/parser'
import { bodyParser } from '../../middleware/body-parser'
import { createHandler as createGraphqlHandler } from '../../middleware/graphql'
import { createHandler as createGraphqlAuthHandler } from '../../middleware/graphql-auth'
import { TYPE } from '@tradle/constants'
import {
  IPBLambdaHttp as Lambda,
  MiddlewareHttp as Middleware,
  IBotComponents,
  IPBHttpMiddlewareContext,
  IUser
} from '../types'

import { sendModelsPackIfUpdated, createModelsPackGetter } from '../plugins/keep-models-fresh'

import { MODELS_HASH_PROPERTY } from '../constants'

export const keepModelsFresh = (lambda: Lambda) => {
  const createSender = (components: IBotComponents) => {
    const { bot, employeeManager, productsAPI } = components
    const getModelsPackForUser = createModelsPackGetter({
      bot,
      employeeManager,
      productsAPI
    })

    return async (user) => {
      const modelsPack = await getModelsPackForUser(user)
      if (!modelsPack) return

      const sent = await sendModelsPackIfUpdated({
        user,
        modelsPack,
        send: (object) => bot.send({ to: user, object })
      })

      if (sent) {
        lambda.tasks.add({
          name: 'saveuser',
          promise: bot.users.merge(pick(user, ['id', MODELS_HASH_PROPERTY]))
        })
      }
    }
  }

  let sendModelsPackToUser
  return async (ctx, next) => {
    const { user, components } = ctx
    if (user) {
      if (!sendModelsPackToUser) {
        sendModelsPackToUser = createSender(components)
      }

      await sendModelsPackToUser(user)
    }

    await next()
  }
}

export const createAuth = (lambda: Lambda) => {
  const isGuestAllowed = ({ ctx, user, query }) => {
    return lambda.isLocal || ctx.components.conf.bot.graphqlAuth === false
  }

  return createGraphqlAuthHandler(lambda, {
    isGuestAllowed,
    canUserRunQuery: (opts) => {
      const { ctx, user, masterUser, query } = opts
      const { employeeManager } = ctx.components as IBotComponents
      if (isGuestAllowed(opts)) return true
      if (employeeManager.isEmployee(opts)) return true

      if (!query.body.includes('rl_tradle_PubKey') &&
          !query.body.includes('rl_tradle_Identity')) return false
      let parsed
      try {
        parsed = parseQuery(JSON.parse(query.body).query)
      } catch (err) {
        lambda.logger.debug('failed to parse query', err)
      }
      const listType = get(parsed, 'definitions[0].selectionSet.selections[0].name.value')
      if (listType === 'rl_tradle_PubKey') return true
      if (listType !== 'rl_tradle_Identity') return false

      let args = get(parsed, 'definitions[0].selectionSet.selections[0].arguments')
      let arg = args.find(a => a.name.value === 'filter')
      if (!arg) return false
      let field = arg.value.fields.find(f => f.name.value === 'EQ')
      let link, permalink
      field.value.fields.forEach(f => {
        let { name, value } = f
        if (name.value === '_permalink')
          permalink = value.value
        else if (name.value === '_link')
          link = value.value
      })
      if (!link  &&  !permalink) return false
      // NEED MORE - the whole user
      if (link) return true
      ///
      if (permalink === user.id) return true
      if (masterUser && permalink === masterUser.id) return true
      return ctx.components.bot.addressBook.byPermalink(masterUser &&  masterUser.id || user.id)
      .then(identity => {
        let id = identity.pubkeys.find(pub => pub.importedFrom === permalink)
        if (id) return true
        return true
      })

      // return [user, masterUser]
      //   .filter(value => value)
      //   .some(user => employeeManager.isEmployee(user))
    }
  })
}

export const createMiddleware = (lambda: Lambda): Middleware => {
  return compose([
    cors(),
    bodyParser({ jsonLimit: '10mb' }),
    createAuth(lambda),
    keepModelsFresh(lambda),
    createGraphqlHandler(lambda),
    async (ctx) => {
      // debugger
      const { models } = ctx.components.bot
      let { data } = ctx.response.body
      const { user, masterUser, employeeManager } = ctx
      let exclude
      let userRoles = (masterUser || user).roles
      if (userRoles.length  &&  userRoles.find(role => role.id.endsWith('_employee')))
      // if (employeeManager.isEmployee({user, masterUser}))
        exclude = 'clientUse'
      else
        exclude = 'internalUse'
      for (let t in data) {
        let result = data[t]
        let { objects, edges } = result 
        if (!objects) {
          if (edges) objects = edges.map(edge => edge.node)
          else objects = [result]
        }
        objects.forEach(obj => {
          let props = models[obj[TYPE]].properties
          for (let p in obj) {
            if (props[p]  &&  props[p][exclude]) {
              delete obj[p]
              // debugger
            }
          } 
        })
      }      
    }
  ])
}
