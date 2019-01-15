import { utils as tradleUtils } from '@tradle/engine'
import validateResource from '@tradle/validate-resource'
import constants from '../constants'
import Errors from '../errors'
import {
  ITradleObject,
  Lambda,
  Logger,
  IUser,
  ILambdaExecutionContext,
} from '../types'
import { isPromise } from '../utils'

const { TYPE, SIG, SIGNATURE_FRESHNESS_LEEWAY } = constants
const FORBIDDEN_MESSAGE = 'forbidden'

interface ITradleGraphqlQuery extends ITradleObject {
  body: any
}

interface CanUserRunQueryInput {
  ctx: ILambdaExecutionContext
  user: IUser
  query: ITradleGraphqlQuery
}

export type CanUserRunQuery = (opts: CanUserRunQueryInput) => boolean

type GAOpts = {
  isGuestAllowed?: CanUserRunQuery
  canUserRunQuery: CanUserRunQuery
}

export const createHandler = ({
  isGuestAllowed,
  canUserRunQuery
}: GAOpts) => {
  return async (ctx: ILambdaExecutionContext, next) => {
    const { bot } = ctx.components
    const { identities, logger } = bot
    const method = ctx.method.toLowerCase()
    if (method === 'options') {
      await next()
      return
    }

    if (method !== 'get' && method !== 'post') {
      logger.debug(`method "${method}" is forbidden`)
      forbid(ctx)
      return
    }

    logger.debug('authenticating')
    const auth = ctx.headers['x-tradle-auth']
    const queryObj:ITradleGraphqlQuery = {
      [TYPE]: 'tradle.GraphQLQuery',
      body: tradleUtils.stringify(ctx.event),
      ...(auth ? JSON.parse(auth) : {})
    }

    try {
      validateResource.resource({
        models: bot.models,
        model: bot.models['tradle.GraphQLQuery'],
        resource: queryObj
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      markInvalid(ctx, `invalid tradle.GraphQLQuery: ${err.message}`)
      return
    }

    const drift = getDrift(queryObj._time)
    if (drift) {
      markInvalid(ctx, `your clock is ${drift.type} ${drift.amount}ms`)
      return
    }

    const isAllowedInput:CanUserRunQueryInput = { ctx, user: null, query: queryObj }
    if (auth == null && !isGuestAllowed(isAllowedInput)) {
      forbid(ctx, `expected header "x-tradle-auth"`)
      logger.debug('expected auth params')
      return
    }

    let user = ctx.user as IUser
    if (auth && !user) {
      logger.debug('looking up query author')
      try {
        await identities.verifyAuthor(queryObj)
        user = await bot.users.get(queryObj._author)
      } catch (err) {
        Errors.rethrow(err, 'system')
        if (Errors.isNotFound(err) || Errors.matches(err, Errors.UnknownAuthor)) {
          forbid(ctx)
        } else {
          setError(ctx, 500, 'something went wrong')
        }

        return
      }
    }

    isAllowedInput.user = user
    let allowed = canUserRunQuery(isAllowedInput)
    if (isPromise(allowed)) allowed = await allowed
    if (!allowed) {
      forbid(ctx)
      return
    }

    logger.debug('allowing')
    await next()
  }
}

const getDrift = (time: number) => {
  const drift = time - Date.now()
  const abs = Math.abs(drift)
  if (abs > SIGNATURE_FRESHNESS_LEEWAY) {
    const type = drift > 0 ? 'ahead' : 'behind'
    return {
      type,
      amount: abs,
    }
  }
}

const forbid = (ctx, message=FORBIDDEN_MESSAGE) => setError(ctx, 403, message)
const markInvalid = (ctx, message) => setError(ctx, 400, message)

const setError = (ctx, status, message) => {
  ctx.status = status
  ctx.body = { message }
}
