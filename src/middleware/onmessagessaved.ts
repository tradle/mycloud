// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import Errors from '../errors'
import { addLinks } from '../crypto'
import { createLocker } from '../locker'
import { allSettled, uniqueStrict } from '../utils'
import { toBotMessageEvent } from '../utils'
import { Bot, Lambda } from '../types'
import { topics as EventTopics, toBatchEvent } from '../events'
import { EventSource } from '../lambda'

/**
 * runs after the message has been written to db
 */
export const onMessagesSaved = (bot:Bot, { async }: { async?: boolean }={}) => {
  const { tasks, logger, isTesting } = bot
  return async (ctx, next) => {
    const { messages } = ctx.event
    if (!messages) return

    await bot._fireMessagesRaw({ messages, async })
    await next()
  }
}

export const createMiddleware = onMessagesSaved
