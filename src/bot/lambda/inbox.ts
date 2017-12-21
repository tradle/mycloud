import compose = require('koa-compose')
import cors = require('kcors')
import { bodyParser } from '../middleware/body-parser'
import { route } from '../middleware/noop-route'
import { EventSource } from '../../lambda'
import * as Inbox from '../middleware/inbox'
import { onmessage } from '../middleware/onmessage'

export const createLambda = (opts) => {
  const lambda = opts.bot.createLambda({
    source: EventSource.HTTP,
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
    cors(),
    bodyParser({ jsonLimit: '10mb' }),
    Inbox.preProcess(lambda, opts),
    onmessage(lambda, opts),
    route(['put', 'post'], '/inbox')
  ])
}
