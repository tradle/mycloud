import _ from 'lodash'
import { sendSuccess, sendError } from '../../cfn-response'
import { Lambda } from '../../types'
import { EventSource, fromCloudFormation } from '../lambda'

export const createLambda = (opts) => {
  const lambda = fromCloudFormation(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { bot } = lambda
  return async (ctx, next) => {
    const { event, context } = ctx
    const { RequestType, ResourceProperties, ResponseURL } = event
    lambda.logger.debug(`received stack event: ${RequestType}`)

    let type = RequestType.toLowerCase()
    type = type === 'create' ? 'init' : type
    ctx.event = {
      type,
      payload: ResourceProperties
    }

    let err
    try {
      // await bot.hooks.fire(type, ctx.event)
      await next()
    } catch (e) {
      err = e
    }

    if (ResponseURL) {
      const respond = err ? sendError : sendSuccess
      const data = err ? _.pick(err, ['message', 'stack']) : {}
      await respond(event, context, data)
      return
    }

    // test mode
    if (err) throw err
  }
}
