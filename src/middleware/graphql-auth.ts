import { utils as tradleUtils } from '@tradle/engine'
import validateResource from '@tradle/validate-resource'
import constants from '../constants'
import Errors from '../errors'
import { ITradleObject, Bot, Logger } from '../types'
import { isPromise } from '../utils'

const { TYPE, SIG, MAX_CLOCK_DRIFT } = constants
const FORBIDDEN_MESSAGE = 'forbidden'

type GAComponents = {
  bot: Bot
  logger: Logger
}

type GAOpts = {
  allowGuest?: boolean
  canUserRunQuery: Function
}

export const createHandler = ({
  bot,
  logger
}: GAComponents, {
  allowGuest,
  canUserRunQuery
}: GAOpts) => {
  const { identities } = bot
  return async (ctx, next) => {
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
    if (!allowGuest && auth == null) {
      forbid(ctx, `expected header "x-tradle-auth"`)
      logger.debug('expected auth params')
      return
    }

    const queryObj:ITradleObject = {
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
      throw new Errors.InvalidInput(`invalid tradle.GraphQLQuery: ${err.message}`)
    }

    checkDrift(queryObj.time)

    let { user } = ctx
    if (auth && !user) {
      logger.debug('looking up query author')
      try {
        await identities.verifyAuthor(queryObj)
        ctx.user = user = await bot.users.get(queryObj._author)
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

    let allowed = canUserRunQuery({ user, query: queryObj })
    if (isPromise(allowed)) allowed = await allowed
    if (!allowed) {
      forbid(ctx)
      return
    }

    logger.debug('allowing')
    await next()
  }
}

const checkDrift = (time: number) => {
  const drift = time - Date.now()
  const abs = Math.abs(drift)
  if (abs > MAX_CLOCK_DRIFT) {
    const type = drift > 0 ? 'ahead' : 'behind'
    throw new Errors.ClockDrift(`your clock is ${type}`)
  }
}

const forbid = (ctx, message=FORBIDDEN_MESSAGE) => setError(ctx, 403, message)

const setError = (ctx, status, message) => {
  ctx.status = status
  ctx.body = { message }
}
