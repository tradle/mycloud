import compose = require('koa-compose')
import { EventSource } from '../../lambda'
import { preProcessIotMessage, onmessage } from '../middleware/onmessage'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.LAMBDA,
    ...opts
  })

  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda, opts) => {
  return compose([
    preProcessIotMessage(lambda, opts),
    onmessage(lambda, opts)
  ])
}
