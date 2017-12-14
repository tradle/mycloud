import clone = require('clone')
import deepEqual = require('deep-equal')
import { TYPE } from '@tradle/constants'
import { addLinks } from '../../crypto'
import { createLocker } from '../locker'
import {
  getMessagePayload,
  getMessageGist,
  savePayloadToDB,
  preProcessMessageEvent
} from '../utils'

import { EventSource } from '../../lambda'

export const onmessage = (lambda, opts) => {
  const { autosave=true } = opts
  const { bot, logger, isTesting } = lambda
  const locker = createLocker({
    name: 'inbound message lock',
    debug: lambda.logger.sub('lock:receive').debug,
    timeout: lambda.isTesting ? null : 10000
  })

  const lock = id => locker.lock(id)
  const unlock = id => locker.unlock(id)
  return async (ctx, next) => {
    let message = ctx.event
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    const userId = message._author
    await lock(userId)
    try {
      const botMessageEvent = await preProcessMessageEvent({ bot, message })
      const userPre = clone(botMessageEvent.user)
      await bot.hooks.fire('message', botMessageEvent)
      await next()
      if (opts.autosave === false) return

      const { user } = botMessageEvent
      if (deepEqual(user, userPre)) {
        logger.debug('user state was not changed by onmessage handler')
      } else {
        logger.debug('merging changes to user state')
        await bot.users.merge(user)
      }
    } finally {
      await unlock(userId)
    }
  }
}
