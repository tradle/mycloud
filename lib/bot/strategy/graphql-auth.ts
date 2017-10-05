const debug = require('debug')('tradle:sls:graphql-auth')
import * as coexpress from 'co-express'
import * as pick from 'object.pick'
import { utils as tradleUtils } from '@tradle/engine'
import * as validateResource from '@tradle/validate-resource'
import { TYPE, SIG, MAX_CLOCK_DRIFT } from '../../constants'
import * as Errors from '../../errors'

export function createGraphQLAuth ({ tradle, bot, employeeManager }) {
  const { identities, objects } = tradle
  return coexpress(function* (req, res, next) {
    const method = req.method.toLowerCase()
    if (method === 'options') {
      next()
      return
    }

    if (method !== 'get' && method !== 'post') {
      res.status(403).json({
        message: `method "${method}" is forbidden`
      })

      return
    }

    debug('authenticating')
    const sig = req.headers['x-tradle-sig']
    if (sig == null) {
      res.status(403).json({
        message: `expected header "x-tradle-sig"`
      })

      debug('expected sig')
      return
    }

    const props = Object.keys(req).filter(key => req[key] != null)
    const body = pick(req, props)
    const queryObj = {
      [TYPE]: 'tradle.GraphQLQuery',
      [SIG]: sig,
      body: tradleUtils.stringify(req.body)
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
    yield identities.addAuthorInfo(queryObj)
    const user = yield bot.users.get(queryObj._author)
    if (!employeeManager.isEmployee(user)) {
      debug('rejecting non-employee')
      res.status(403).json({
        message: 'employees only'
      })

      return
    }

    debug('allowing')
    next()
  })
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
