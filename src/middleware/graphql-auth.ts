import { utils as tradleUtils } from '@tradle/engine'
import validateResource from '@tradle/validate-resource'
import constants from '../constants'
import Errors from '../errors'
import { ITradleObject, Bot, Logger } from '../types'
import { isPromise } from '../utils'

const { TYPE, SIG, MAX_CLOCK_DRIFT } = constants

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
      ctx.status = 403
      ctx.body = {
        message: `method "${method}" is forbidden`
      }

      return
    }

    await next()
    return

    // logger.debug('authenticating')
    // const sig = ctx.headers['x-tradle-sig']
    // if (!allowGuest && sig == null) {
    //   ctx.status = 403
    //   ctx.body = {
    //     message: `expected header "x-tradle-sig"`
    //   }

    //   logger.debug('expected sig')
    //   return
    // }

    // const queryObj:ITradleObject = {
    //   [TYPE]: 'tradle.GraphQLQuery',
    //   body: tradleUtils.stringify(ctx.event)
    // }

    // if (sig) queryObj[SIG] = sig

    // try {
    //   validateResource.resource({
    //     models: bot.models,
    //     model: bot.models['tradle.GraphQLQuery'],
    //     resource: queryObj
    //   })
    // } catch (err) {
    //   throw new Errors.InvalidInput(`invalid tradle.GraphQLQuery: ${err.message}`)
    // }

    // // checkDrift(queryObj.time)

    // let { user } = ctx
    // if (sig && !user) {
    //   logger.debug('looking up query author')
    //   try {
    //     await identities.verifyAuthor(queryObj)
    //     ctx.user = user = await bot.users.get(queryObj._author)
    //   } catch (err) {
    //     Errors.rethrow(err, 'system')
    //     if (Errors.isNotFound(err) || Errors.matches(err, Errors.UnknownAuthor)) {
    //       ctx.status = 403
    //       ctx.body = {
    //         message: 'not allowed'
    //       }
    //     } else {
    //       ctx.status = 500
    //       ctx.body = {
    //         message: 'something went wrong'
    //       }
    //     }

    //     return
    //   }
    // }

    // let allowed = canUserRunQuery({ user, query: queryObj })
    // if (isPromise(allowed)) allowed = await allowed
    // if (!allowed) {
    //   ctx.status = 403
    //   ctx.body = {
    //     message: 'not allowed'
    //   }

    //   return
    // }

    // logger.debug('allowing')
    // await next()
  }
}

function checkDrift (time) {
  time = Number(time)
  const drift = time - Date.now()
  const abs = Math.abs(drift)
  if (abs > MAX_CLOCK_DRIFT) {
    const type = drift > 0 ? 'ahead' : 'behind'
    throw new Errors.ClockDrift(`your clock is ${type}`)
  }
}
