import compose = require('koa-compose')
import cors = require('kcors')
import { bodyParser } from '../middleware/body-parser'
import { Lambda, EventSource, fromHTTP } from '../lambda'
import * as Inbox from '../middleware/inbox'
import { onmessage } from '../middleware/onmessage'

export const createLambda = (opts) => {
  const lambda = fromHTTP(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  return compose([
    cors(),
    bodyParser({ jsonLimit: '10mb' }),
    Inbox.preProcess(lambda, opts),
    onmessage(lambda, opts)
  ])
}
