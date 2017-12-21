import { pick } from 'lodash'
import cfnResponse = require('cfn-response')
import { EventSource, fromCloudFormation, Lambda } from '../lambda'

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
    ctx.event = {
      type: type === 'create' ? 'init' : type,
      payload: ResourceProperties
    }

    let err
    try {
      await bot.hooks.fire('init', ctx.event)
      await next()
    } catch (e) {
      err = e
    }

    if (ResponseURL) {
      const type = err ? cfnResponse.FAILED : cfnResponse.SUCCESS
      const props = err ? pick(err, ['message', 'stack']) : {}
      cfnResponse.send(event, context, type, props)
    } else {
      context.done(err)
    }
  }
}
