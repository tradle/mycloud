// @ts-ignore
import Promise = require('bluebird')
import compose = require('koa-compose')
import {
  cloneDeep,
  isEqual
} from 'lodash'

import { TYPE } from '@tradle/constants'
import Errors = require('../../errors')
import { addLinks } from '../../crypto'
import { createLocker } from '../locker'
import { allSettled, uniqueStrict } from '../../utils'
import {
  getMessagePayload,
  getMessageGist,
  savePayloadToDB
} from '../utils'

import { EventSource } from '../../lambda'

/**
 * runs after the inbound message has been written to inbox
 */
export const onMessagesSaved = (lambda, opts) => {
  const { autosave=true } = opts
  const { bot, tradle, tasks, logger, isTesting } = lambda
  const locker = createLocker({
    name: 'inbound message lock',
    debug: lambda.logger.sub('lock:receive').debug,
    timeout: lambda.isTesting ? null : 10000
  })

  const lock = id => locker.lock(id)
  const unlock = id => locker.unlock(id)
  return async (ctx, next) => {
    const { messages } = ctx.event
    if (!messages) return

    const authors = uniqueStrict(messages.map(({ _author }) => _author))
    if (authors.length > 1) {
      throw new Error('only messages from a single author allowed')
    }

    const userId = authors[0]
    let botMessageEvent
    await lock(userId)
    try {
      ctx.user = await bot.users.createIfNotExists({ id: userId })
      let { user } = ctx
      let userPre = cloneDeep(user)
      for (const message of messages) {
        if (bot.isTesting) {
          await savePayloadToDB({ bot, message })
        }

        botMessageEvent = toBotMessageEvent({ bot, user, message })
        await bot.hooks.fire('message', botMessageEvent)
      }

      if (autosave) {
        user = botMessageEvent.user
        if (isEqual(user, userPre)) {
          logger.debug('user state was not changed by onmessage handler')
        } else {
          logger.debug('merging changes to user state')
          await bot.users.merge(user)
        }
      }
    } finally {
      await unlock(userId)
    }

    await next()
  }
}

const toBotMessageEvent = ({ bot, user, message }):any => {
  // identity permalink serves as user id
  const payload = message.object
  const type = payload[TYPE]
  return {
    bot,
    user,
    message,
    payload,
    type,
    link: payload._link,
    permalink: payload._permalink,
  }
}
