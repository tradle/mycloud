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

const COUNTERPARTY_CONCURRENCY = { concurrency: 5 }

const batchedPromiseMap = (arr, fn) => Promise.map(arr, fn, COUNTERPARTY_CONCURRENCY)

export const createMiddleware = (bot:Bot, { async }) => {
  return onMessagesSaved(bot, { async })
}

/**
 * runs after the inbound message has been written to inbox
 */
export const onMessagesSaved = (bot:Bot, { async }: { async?: boolean }={}) => {
  const { tasks, logger, isTesting } = bot
  const locker = createLocker({
    // name: 'inbound message lock',
    // debug: lambda.logger.sub('lock:receive').debug,
    timeout: bot.isTesting ? null : 10000
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
    if (async) {
      return await batchedPromiseMap(_.values(byRecipient), async (batch) => {
        await bot._fireMessageBatchEvent({ batch, async, spread: true })
      })
    }

    return await batchedPromiseMap(_.values(byRecipient), async (batch) => {
      return await Promise.mapSeries(batch, data => bot._fireMessageEvent({ data, async }))
    })
  }

  const fireInbound = async (messages, async) => {
    if (!messages.length) return

    const bySender = _.groupBy(messages, '_author')
    return await batchedPromiseMap(_.values(bySender), async (batch) => {
      const userId = batch[0]._author
      await lock(userId)
      try {
        const user = await bot.users.createIfNotExists({ id: userId })
        const batch = messages.map(message => toBotMessageEvent({ bot, user, message }))
        // logger.debug(`feeding ${messages.length} messages to business logic`)
        if (async) {
          await bot._fireMessageBatchEvent({ inbound: true, batch, async, spread: true })
        } else {
          await Promise.mapSeries(batch, data => bot._fireMessageEvent({ data, async, inbound: true }))
        }
      } finally {
        await unlock(userId)
      }
    })
  }

  return async (ctx, next) => {
    const { messages } = ctx.event
    if (!messages) return

    const [inbound, outbound] = _.partition(messages, ({ _inbound }) => _inbound)
    await Promise.all([
      fireInbound(inbound, async),
      fireOutbound(outbound, async)
    ])

    await next()
  }
}
