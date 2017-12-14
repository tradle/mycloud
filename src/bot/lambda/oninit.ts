import pick = require('object.pick')
import cfnResponse = require('cfn-response')
import { EventSource } from '../../lambda'

export const createLambda = (opts) => {
  return outfitLambda(opts.bot.createLambda({
    source: EventSource.CLOUDFORMATION,
    ...opts
  }), opts)
}

export const outfitLambda = (lambda, opts) => {
  const { bot } = lambda
  lambda.use(async (ctx, next) => {
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
  })

  return lambda
}
