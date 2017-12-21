import { EventSource, Lambda, fromHTTP } from '../lambda'
import { createGraphQLRouter } from '../graphql'
import { defineGetter } from '../../utils'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  const router = createRouter(lambda, opts)
  defineGetter(lambda, 'setGraphQLAuth', () => router.setGraphQLAuth)
  defineGetter(lambda, 'setGraphiqlOptions', () => router.setGraphiqlOptions)
  defineGetter(lambda, 'getGraphiqlAPI', () => router.getGraphiqlAPI)

  return lambda.use(router.routes())
}

export const createRouter = (lambda, opts) => createGraphQLRouter(lambda)
