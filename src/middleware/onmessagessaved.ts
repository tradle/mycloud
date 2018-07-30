// @ts-ignore
import Promise from 'bluebird'
import { Bot } from '../types'

/**
 * runs after the message has been written to db
 */
export const onMessagesSaved = (bot:Bot, { async }: { async?: boolean }={}) => {
  const { tasks, logger } = bot
  return async (ctx, next) => {
    const { messages } = ctx.event
    if (!messages) return

    await bot._fireMessagesRaw({ messages, async })
    await next()
  }
}

export const createMiddleware = onMessagesSaved
