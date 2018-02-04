import {
  EventSource,
  Lambda
} from '../bot/lambda'

import { createBot } from '../bot'
import { customize } from './customize'

export {
  EventSource
}

export const createLambda = opts => {
  const {
    event,
    bot = createBot({ ready: false })
  } = opts

  const lambda = new Lambda({ bot, ...opts })
  const componentsPromise = customize({ lambda, event })
  lambda.use(async (ctx, next) => {
    ctx.components = await componentsPromise
    await next()
  })

  return lambda
}
