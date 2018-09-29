// import Router from 'koa-router'
// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import graphqlHTTP from 'koa-graphql'
import { formatError } from 'graphql'
import once from 'lodash/once'
import { route } from './noop-route'
import { Level } from '../logger'
import { logResponseBody } from '../utils'
import { prettifyQuery } from '../graphql'
import {
  LambdaHttp as Lambda,
  MiddlewareHttp as Middleware,
  ILambdaExecutionContext,
  Bot,
} from '../types'

import Errors from '../errors'

export const createHandler = (lambda:Lambda):Middleware => {
  const { logger } = lambda

  let api
  let modelsVersionId:string
  let bot

  const watchModels = once((bot: Bot) => {
  // allow models to be set asynchronously
    const { modelStore } = bot

    const updateVersionId = modelsPack => {
      modelsVersionId = modelsPack.versionId
    }

    if (modelStore.cumulativeModelsPack) {
      updateVersionId(modelStore.cumulativeModelsPack)
    }

    modelStore.on('update:cumulative', updateVersionId)
  })

  const setup = async (ctx: ILambdaExecutionContext, next) => {
    bot = ctx.components.bot
    watchModels(bot)
    await bot.promiseReady()
    await next()
  }

  const handler = graphqlHTTP(async (req) => {
    logger.debug(`hit graphql query route, ready: ${bot.isReady()}`)
    const api = bot.graphql
    const { query, variables } = req.body
    if (query && query.indexOf('query IntrospectionQuery') === -1) {
      logger.ridiculous(`received query:\n ${prettifyQuery(req.body.query)}`)
    }

    if (variables && variables.modelsVersionId) {
      if (modelsVersionId !== variables.modelsVersionId) {
        throw new Error(`expected models with versionId: ${modelsVersionId}`)
      }
    }

    return {
      get schema() { return api.schema },
      graphiql: api.graphiqlOptions,
      formatError: err => {
        logger.error('experienced error executing GraphQL query', Errors.export(err))
        return formatError(err)
      }
    }
  })

  const middleware = [
    route(['get', 'post']),
    setup,
    handler
  ]

  if (logger.level >= Level.SILLY) {
    middleware.push(logResponseBody(logger))
  }

  // router.setGraphQLAuth = authImpl => auth = authImpl
  // router.use(cors())
  // router.use(bodyParser({ jsonLimit: '10mb' }))

  // router.use('/graphql', async (ctx, next) => {
  //   logger.debug(`hit graphql auth route, ready: ${bot.isReady()}`)
  //   await bot.promiseReady()
  //   if (auth) {
  //     await auth(ctx, next)
  //   } else {
  //     await next()
  //   }
  // })

  return compose(middleware)
}
