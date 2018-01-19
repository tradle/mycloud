import compose = require('koa-compose')
import cors = require('kcors')
import { pick } from 'lodash'
import { bodyParser } from '../../bot/middleware/body-parser'
import { Lambda } from '../../bot/lambda'
import {
  sendModelsPackIfUpdated,
  createModelsPackGetter
} from '../strategy/keep-models-fresh'

import { defineGetter } from '../../utils'
import { MODELS_HASH_PROPERTY } from '../constants'

export const keepModelsFresh = (lambda:Lambda, components) => {
  const { bot } = lambda
  const {
    productsAPI,
    employeeManager,
  } = components

  const getModelsPackForUser = createModelsPackGetter({ bot, ...components })
  const sendModelsPackToUser = async (user) => {
    const modelsPack = await getModelsPackForUser(user)
    if (!modelsPack) return

    const sent = await sendModelsPackIfUpdated({
      user,
      modelsPack,
      send: object => bot.send({ to: user, object })
    })

    if (sent) {
      lambda.tasks.add({
        name: 'saveuser',
        promise: bot.users.merge(pick(user, ['id', MODELS_HASH_PROPERTY]))
      })
    }
  }

  return async (ctx, next) => {
    const { user } = ctx
    if (user) {
      await sendModelsPackToUser(user)
    }

    await next()
  }
}

export const createAuth = (lambda: Lambda, components) => {
  const allowGuest = lambda.stage === 'dev'
  const { employeeManager } = components
  return lambda.bot.middleware.graphql.auth(lambda, {
    allowGuest,
    canUserRunQuery: ({ user, query }) => {
      return allowGuest || (user && employeeManager.isEmployee(user))
    }
  })
}

export const createMiddleware = (lambda:Lambda, components) => {
  const graphqlHandler = lambda.bot.middleware.graphql.queryHandler(lambda, components)
  const middleware = compose([
    cors(),
    bodyParser({ jsonLimit: '10mb' }),
    createAuth(lambda, components),
    keepModelsFresh(lambda, components),
    graphqlHandler
  ])

  defineGetter(middleware, 'setGraphiqlOptions', () => graphqlHandler.setGraphiqlOptions)
  defineGetter(middleware, 'getGraphqlAPI', () => graphqlHandler.getGraphqlAPI)
  return middleware
}
