import { utils as tradleUtils } from '@tradle/engine'
import validateResource = require('@tradle/validate-resource')
import { constants, Errors } from '../../'
import { ITradleObject } from '../../types'
import { isPromise } from '../../utils'

const debug = require('debug')('tradle:sls:graphql-auth')
const { TYPE, SIG, MAX_CLOCK_DRIFT } = constants

export const createHandler = ({ bot }, { allowGuest, canUserRunQuery }) => {
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

    debug('authenticating')
    const sig = ctx.headers['x-tradle-sig']
    if (!allowGuest && sig == null) {
      ctx.status = 403
      ctx.body = {
        message: `expected header "x-tradle-sig"`
      }

      debug('expected sig')
      return
    }

    const queryObj:ITradleObject = {
      [TYPE]: 'tradle.GraphQLQuery',
      body: tradleUtils.stringify(ctx.event)
    }

    if (sig) queryObj[SIG] = sig

    try {
      validateResource({
        models: bot.models,
        model: bot.models['tradle.GraphQLQuery'],
        resource: queryObj
      })
    } catch (err) {
      throw new Errors.InvalidInput(`invalid tradle.GraphQLQuery: ${err.message}`)
    }

    checkDrift(queryObj.time)

    let { user } = ctx
    if (sig && !user) {
      debug('looking up query author')
      await identities.addAuthorInfo(queryObj)
      ctx.user = user = await bot.users.get(queryObj._author)
    }

    let allowed = canUserRunQuery({ user, query: queryObj })
    if (isPromise(allowed)) allowed = await allowed
    if (!allowed) {
      ctx.status = 403
      ctx.body = {
        message: 'not allowed'
      }

      return
    }

    debug('allowing')
    await next()
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
