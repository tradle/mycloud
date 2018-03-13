import { pick } from 'lodash'
import Koa from 'koa'
import { Lambda } from '../../lambda'
import { IPBHttpMiddlewareContext } from '../types'
import { fromHTTP } from '../lambda'

export const createLambda = (opts):Lambda => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts:any={}) => {
  return async (ctx:IPBHttpMiddlewareContext, next) => {
    const { components, query={} } = ctx
    const { code } = query
    const { emailBasedVerifier } = components
    await emailBasedVerifier.processConfirmationCode(Array.isArray(code) ? code[0] : code)
  }
}
