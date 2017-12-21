import compose = require('koa-compose')
import { EventSource, Lambda, fromLambda } from '../lambda'
import { preProcessIotMessage, onmessage } from '../middleware/onmessage'

export const createLambda = (opts) => {
  const lambda = fromLambda(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  return compose([
    preProcessIotMessage(lambda, opts),
    onmessage(lambda, opts)
  ])
}
