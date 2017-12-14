import { EventSource, Lambda } from '../../lambda'
import { createGraphQLRouter } from '../graphql'
import { defineGetter } from '../../utils'

export const createLambda = (opts) => {
  return outfitLambda(opts.bot.createLambda({
    source: EventSource.HTTP,
    ...opts
  }), opts)
}

export const outfitLambda = (lambda, opts) => {
  const router = createGraphQLRouter(lambda)
  lambda.use(router.routes())
  defineGetter(lambda, 'setGraphQLAuth', () => router.setGraphQLAuth)
  defineGetter(lambda, 'setGraphiqlOptions', () => router.setGraphiqlOptions)
  defineGetter(lambda, 'getGraphiqlAPI', () => router.getGraphiqlAPI)
  return lambda
}
