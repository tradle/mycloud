// @ts-ignore
import Promise = require('bluebird')
import { Lambda, fromDynamoDB } from '../lambda'
import Errors = require('../../errors')

const notNull = val => !!val
const promiseNoop = async () => {}

export const onMessage = (lambda:Lambda, opts?:any) => {
  const { logger, tradle } = lambda
  const { user } = tradle
  return async (ctx, next) => {
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
}

export const createSuccessHandler = (lambda, opts) => promiseNoop
export const createErrorHandler = (lambda, opts) => async ({ message, error }) => {
  Errors.ignore(error, Errors.Duplicate)
}
