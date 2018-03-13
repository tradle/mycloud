import { pick } from 'lodash'
import Koa from 'koa'
import { Lambda } from '../../lambda'
import { IBotComponents } from '../types'
import { fromDynamoDB } from '../lambda'

export const createLambda = (opts):Lambda => {
  const lambda = fromDynamoDB(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts:any={}) => {
  return async (ctx:Koa.Context, next) => {
    const { components, query={} } = ctx
    const { code } = query
    const { emailBasedVerifier } = <IBotComponents>components
    await emailBasedVerifier.processConfirmationCode(Array.isArray(code) ? code[0] : code)
  }
}
