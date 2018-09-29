import { IPBHttpMiddlewareContext } from '../types'
import { fromHTTP } from '../lambda'

export const createMiddleware = () => async (ctx:IPBHttpMiddlewareContext, next) => {
  const { components, query={} } = ctx
  const { code } = query
  const { emailBasedVerifier } = components
  const result = await emailBasedVerifier.processConfirmationCode(Array.isArray(code) ? code[0] : code)
  ctx.body = result.html
}
