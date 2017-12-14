const debug = require('debug')('tradle:sls:graphql-auth')
import pick = require('object.pick')
import { utils as tradleUtils } from '@tradle/engine'
import validateResource = require('@tradle/validate-resource')
import { constants, Errors } from '../../'
const { TYPE, SIG, MAX_CLOCK_DRIFT } = constants

export function createGraphQLAuth ({ bot, employeeManager }) {
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
    if (sig == null) {
      ctx.status = 403
      ctx.body = {
        message: `expected header "x-tradle-sig"`
      }

      debug('expected sig')
      return
    }

    const req = ctx.request
    // TODO: rewrite next two lines
    const props = Object.keys(req).filter(key => req[key] != null)
    const body = pick(req, props)
    const queryObj = {
      [TYPE]: 'tradle.GraphQLQuery',
      [SIG]: sig,
      body: tradleUtils.stringify(body)
    }

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

    debug('looking up query author')
    await identities.addAuthorInfo(queryObj)
    const user = await bot.users.get(queryObj._author)
    if (!employeeManager.isEmployee(user)) {
      debug('rejecting non-employee')
      ctx.status = 403
      ctx.body = {
        message: 'employees only'
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
