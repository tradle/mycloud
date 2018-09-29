import { Lambda, ILambdaExecutionContext } from '../types'

/**
 * runs after the message has been written to db
 */
export const onMessagesSaved = () => async (ctx: ILambdaExecutionContext, next) => {
  const { bot } = ctx.components
  const { tasks, logger } = bot
  const { messages } = ctx.event
  if (!messages) return

  await bot._fireMessagesRaw({ messages })
  await next()
}

export const createMiddleware = onMessagesSaved
