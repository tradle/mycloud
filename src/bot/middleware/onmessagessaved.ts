// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import Errors from '../../errors'
import { addLinks } from '../../crypto'
import { createLocker } from '../locker'
import { allSettled, uniqueStrict } from '../../utils'
import { toBotMessageEvent } from '../utils'
import { Lambda } from '../../types'
import { topics as EventTopics, toBatchEvent } from '../../events'
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
    // name: 'inbound message lock',
    // debug: lambda.logger.sub('lock:receive').debug,
    timeout: lambda.isTesting ? null : 10000
  })

  const lock = id => locker.lock(id)
  const unlock = id => locker.unlock(id)
  const fireOutbound = async (messages, async) => {
    if (!messages.length) return

    const recipientPermalinks = uniqueStrict(messages.map(({ _recipient }) => _recipient))
    const recipients = await Promise.map(recipientPermalinks, permalink => bot.users.get(permalink))
    const events = messages.map(message => toBotMessageEvent({
      bot,
      user: recipients.find(user => user.id === message._recipient),
      message
    }))

    const byRecipient = _.groupBy(events, event => event.user.id)
    return await Promise.map(_.values(byRecipient), async (batch) => {
      await bot._fireMessageBatchEvent({ batch, async, spread: true })
    })
  }

  const fireInbound = async (messages, async) => {
    if (!messages.length) return

    const authors = uniqueStrict(messages.map(({ _author }) => _author))
    if (authors.length > 1) {
      throw new Error('only messages from a single author allowed')
    }

    const userId = authors[0]
    await lock(userId)
    try {
      const user = await bot.users.createIfNotExists({ id: userId })
      const batch = messages.map(message => toBotMessageEvent({ bot, user, message }))
      logger.debug(`feeding ${messages.length} messages to business logic`)
      await bot._fireMessageBatchEvent({ inbound: true, batch, async, spread: true })
    } finally {
      await unlock(userId)
    }
  }

  return async (ctx, next) => {
    const { messages } = ctx.event
    if (!messages) return

    const [inbound, outbound] = _.partition(messages, ({ _inbound }) => _inbound)
    const async = lambda.source === EventSource.DYNAMODB
    await Promise.all([
      fireInbound(inbound, async),
      fireOutbound(outbound, async)
    ])

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
