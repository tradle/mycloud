import { Lambda, ILambdaExecutionContext } from '../types'
import Errors from '../errors'

export const onMessage = () => async (ctx: ILambdaExecutionContext, next) => {
  const { logger } = ctx.components.bot
  const { messages } = ctx.event
  if (!messages) {
    ctx.body = {
      message: 'invalid payload, expected {"messages":[]}'
    }

    ctx.status = 400
    return
  }

  await next()
}

export const createSuccessHandler = () => async () => {}
export const createErrorHandler = () => async ({ message, error }) => {
  Errors.ignore(error, Errors.Duplicate)
}
