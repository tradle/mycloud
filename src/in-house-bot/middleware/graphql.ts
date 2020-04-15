import compose from 'koa-compose'
import cors from 'kcors'
import { get, pick, once } from 'lodash'
import { parse as parseQuery } from 'graphql/language/parser'
import { bodyParser } from '../../middleware/body-parser'
import { createHandler as createGraphqlHandler } from '../../middleware/graphql'
import { createHandler as createGraphqlAuthHandler } from '../../middleware/graphql-auth'
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

      try {
        if (query.body.includes('rl_tradle_PubKey')) {
          const parsed = parseQuery(JSON.parse(query.body).query)
          const listType = get(parsed, 'definitions[0].selectionSet.selections[0].name.value')
          if (listType === 'rl_tradle_PubKey') return true
        }
      } catch (err) {
        lambda.logger.debug('failed to parse query', err)
      }
      return employeeManager.isEmployee(opts)
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
    createGraphqlHandler(lambda)
  ])
}
