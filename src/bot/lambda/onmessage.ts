// @ts-ignore
import Promise = require('bluebird')
import compose = require('koa-compose')
import { Lambda, fromLambda } from '../lambda'
import { onMessage as onIotMessage, createSuccessHandler, createErrorHandler } from '../middleware/oniotmessage'
import { onMessage } from '../middleware/onmessage'
import { onMessagesSaved } from '../middleware/onmessagessaved'

export const createLambda = (opts?:any) => {
  const lambda = fromLambda(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  return compose([
    onIotMessage(lambda, opts),
    onMessage(lambda, {
      onSuccess: createSuccessHandler(lambda, opts),
      onError: createErrorHandler(lambda, opts)
    }),
    onMessagesSaved(lambda, opts)
  ])
}
