import { utils as tradleUtils } from '@tradle/engine'
import validateResource from '@tradle/validate-resource'
import constants from '../constants'
import Errors from '../errors'
import { ITradleObject, Bot, Logger, IUser } from '../types'
import { isPromise } from '../utils'
import { isMaster } from 'cluster'

const { TYPE, SIG, SIGNATURE_FRESHNESS_LEEWAY } = constants
const FORBIDDEN_MESSAGE = 'forbidden'

type GAComponents = {
  bot: Bot
  logger: Logger
}

interface CanUserRunQueryInput {
  ctx: any
  user: IUser
  masterUser?: IUser
  query: any
}

type CanUserRunQuery = (opts: CanUserRunQueryInput) => boolean

type GAOpts = {
  isGuestAllowed?: (ctx: any) => boolean
  canUserRunQuery: CanUserRunQuery
}

export const createHandler = (
  { bot, logger }: GAComponents,
  { isGuestAllowed, canUserRunQuery }: GAOpts
) => {
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
    const queryObj: ITradleObject = {
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

    const isAllowedInput = { ctx, user: null, query: queryObj }
    if (auth == null && !isGuestAllowed(isAllowedInput)) {
      forbid(ctx, `expected header "x-tradle-auth"`)
      logger.debug('expected auth params')
      return
    }

    let { user, components } = ctx
    if (auth && !user) {
      logger.debug('looking up query author')
      try {
        bot.objects.addMetadata(queryObj)
        await identities.verifyAuthor(queryObj)
        const users = await Promise.all([
          bot.users.get(queryObj._author),
          queryObj._masterAuthor ? bot.users.get(queryObj._masterAuthor) : Promise.resolve(null)
        ])

        ctx.user = user = users[0]
        ctx.masterUser = users[1]
        ctx.counterparty = await getCounterparty(bot, ctx)
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

    let allowed = canUserRunQuery({ ...isAllowedInput, user, masterUser: ctx.masterUser })
    if (isPromise(allowed)) allowed = await allowed
    if (!allowed) {
      forbid(ctx)
      return
    }

    logger.debug('allowing')
    await next()
  }
}
const getCounterparty = async (bot, {user, masterUser, components}) => {
  if (!components)
    debugger
  let userPermalink
  if (components.employeeManager.isEmployee({user, masterUser})) {
    userPermalink = masterUser && masterUser.identity._permalink || user.identity._permalink
  }
  // if (masterUser  &&  masterUser.roles) {
  //   if (masterUser.roles.find(r => r.id.endsWith('_employee')))
  //   userPermalink = masterUser.identity._permalink
  // }
  // else {
  //   if (user.roles.find(r => r.id.endsWith('_employee')))
  //   userPermalink = user.identity._permalink
  // }
  if (!userPermalink) 
    return
  const cert = await bot.db.findOne({
    filter: {
      EQ: {
        [TYPE]: 'tradle.MyEmployeeOnboarding',
        'owner._permalink': userPermalink
      }
    }
  })
  return cert.counterparty
}

const getDrift = (time: number) => {
  const drift = time - Date.now()
  const abs = Math.abs(drift)
  if (abs > SIGNATURE_FRESHNESS_LEEWAY) {
    const type = drift > 0 ? 'ahead' : 'behind'
    return {
      type,
      amount: abs
    }
  }
}

const forbid = (ctx, message = FORBIDDEN_MESSAGE) => setError(ctx, 403, message)
const markInvalid = (ctx, message) => setError(ctx, 400, message)

const setError = (ctx, status, message) => {
  ctx.status = status
  ctx.body = { message }
}
