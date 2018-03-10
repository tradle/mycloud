// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import Errors from '../../errors'
import { addLinks } from '../../crypto'
import { createLocker } from '../locker'
import { allSettled, uniqueStrict } from '../../utils'
import { Lambda } from '../../types'
import { EventSource } from '../lambda'

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const stack = [
    onMessagesSaved(lambda, opts)
  ]

  // if (lambda.source !== EventSource.DYNAMODB && lambda.isUsingServerlessOffline) {
  //   // fake process stream
  //   stack.push(toStreamAndProcess(lambda, opts))
  // }

  return compose(stack)
}

/**
 * runs after the inbound message has been written to inbox
 */
export const onMessagesSaved = (lambda:Lambda, opts={}) => {
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

    const inbound = messages.filter(({ _inbound }) => _inbound)
    if (!inbound.length) return

    const authors = uniqueStrict(inbound.map(({ _author }) => _author))
    if (authors.length > 1) {
      throw new Error('only messages from a single author allowed')
    }

    const userId = authors[0]
    await lock(userId)
    try {
      ctx.user = await bot.users.createIfNotExists({ id: userId })
      const { user } = ctx
      logger.debug(`feeding ${inbound.length} messages to business logic`)
      for (const message of inbound) {
        const botMessageEvent = toBotMessageEvent({ bot, user, message })
        await bot.hooks.fire('message', botMessageEvent)
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
  const { object } = message
  const type = object[TYPE]
  return {
    bot,
    user,
    message,
    payload: object,
    object,
    type,
    link: object._link,
    permalink: object._permalink,
  }
}

const toStream = (lambda:Lambda, opts?:any) => {
  const { toStreamItems } = require('../../test/utils')
  const { tradle } = lambda
  return async (ctx, next) => {
    ctx.event = toStreamItems(tradle.tables.Messages.name, ctx.event.messages.map(m => {
      return {
        new: tradle.messages.formatForDB(m)
      }
    }))

    await next()
  }
}
