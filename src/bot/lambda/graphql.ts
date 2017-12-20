import { EventSource, Lambda } from '../../lambda'
import { createGraphQLRouter } from '../graphql'
import { defineGetter } from '../../utils'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.HTTP,
    ...opts
  })

  const router = createRouter(lambda, opts)
  defineGetter(lambda, 'setGraphQLAuth', () => router.setGraphQLAuth)
  defineGetter(lambda, 'setGraphiqlOptions', () => router.setGraphiqlOptions)
  defineGetter(lambda, 'getGraphiqlAPI', () => router.getGraphiqlAPI)

  return lambda.use(router.routes())
}

export const createRouter = (lambda, opts) => createGraphQLRouter(lambda)
