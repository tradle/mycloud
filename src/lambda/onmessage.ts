import compose from 'koa-compose'
import { onMessage as onIotMessage, createSuccessHandler, createErrorHandler } from '../middleware/oniotmessage'
import { onMessage } from '../middleware/onmessage'
import { createMiddleware as onMessagesSaved } from '../middleware/onmessagessaved'
import { logifyFunction } from '../utils'
import { createLogger } from '../logger'

const logger = createLogger(`onmessage:middleware`)

export const createMiddleware = () => {
  return compose([
    onIotMessage(),
    logifyFunction({
      fn: onMessage({
        onSuccess: createSuccessHandler(),
        onError: createErrorHandler()
      }),
      name: 'preprocess message',
      level: 'silly',
      logger
    }),
    logifyFunction({
      fn: onMessagesSaved(),
      name: 'business logic',
      level: 'silly',
      logger
    })
  ])
}
