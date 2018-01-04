// @ts-ignore
import Promise = require('bluebird')
import compose = require('koa-compose')
import _ = require('lodash')
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

import { EventSource, Lambda } from '../../lambda'

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const stack = [
    onMessagesSaved(lambda, opts)
  ]

  if (lambda.isUsingServerlessOffline) {
    // fake process stream
    stack.push(toStreamAndProcess(lambda, opts))
  }

  return compose(stack)
}

/**
 * runs after the inbound message has been written to inbox
 */
export const onMessagesSaved = (lambda:Lambda, opts={}) => {
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
      let userPre = _.cloneDeep(user)
      for (const message of messages) {
        botMessageEvent = toBotMessageEvent({ bot, user, message })
        await bot.hooks.fire('message', botMessageEvent)
      }

      if (autosave) {
        user = botMessageEvent.user
        if (_.isEqual(user, userPre)) {
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

export const toStreamAndProcess = (lambda:Lambda, opts?: any) => {
  const onMessageStream = require('./onmessagestream')
  return compose([
    toStream(lambda, opts),
    onMessageStream.createMiddleware(lambda, opts)
  ])
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

const toStream = (lambda:Lambda, opts?:any) => {
  const { toStreamItems } = require('../../test/utils')
  const { tradle } = lambda
  return async (ctx, next) => {
    ctx.event = toStreamItems(ctx.event.messages.map(m => {
      const change = {}
      change.new = tradle.messages.formatForDB(m)
      return change
    }))

    await next()
  }
}
