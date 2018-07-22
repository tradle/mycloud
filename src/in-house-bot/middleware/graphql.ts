import compose from 'koa-compose'
import cors from 'kcors'
import { pick } from 'lodash'
import { bodyParser } from '../../middleware/body-parser'
import { createHandler as createGraphqlHandler } from '../../middleware/graphql'
import { createHandler as createGraphqlAuthHandler } from '../../middleware/graphql-auth'
import { IPBLambdaHttp as Lambda } from '../types'
import {
  sendModelsPackIfUpdated,
  createModelsPackGetter
} from '../plugins/keep-models-fresh'

import { defineGetter } from '../../utils'
import { MODELS_HASH_PROPERTY } from '../constants'
import { MiddlewareHttp as Middleware, IBotComponents } from '../types'

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

export const createAuth = (lambda: Lambda, components:IBotComponents) => {
  const allowGuest = lambda.isTesting || components.conf.bot.graphqlAuth == false
  const { employeeManager } = components
  return createGraphqlAuthHandler(lambda, {
    allowGuest,
    canUserRunQuery: ({ user, query }) => {
      return allowGuest || (user && employeeManager.isEmployee(user))
    }
  })
}

export const createMiddleware = (lambda:Lambda, components):Middleware => {
  return compose([
    cors(),
    bodyParser({ jsonLimit: '10mb' }),
    createAuth(lambda, components),
    keepModelsFresh(lambda, components),
    createGraphqlHandler(lambda, components)
  ])
}
