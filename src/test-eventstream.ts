import { TYPE } from '@tradle/constants'
import { Bot } from './types'
import {
  wait
} from './utils'

import { EventTopic, topics as EventTopics } from './events'
// import { createMiddleware as createMessageMiddleware } from './middleware/onmessagestream'

/**
 * Set up processing that's usually done asynchronously on DynamoDB Stream
 * Re-emit various events as 'async' and/or 'batch'
 */
export const simulateEventStream = (bot: Bot) => {
  const reemitSave = async ({ args, result }) => {
    if (args[0][TYPE] === 'tradle.IotSession') {
      bot.logger.debug('not re-emitting IotSession event, too taxing in dev env')
      return
    }

    const value = result || await bot.db.get(args[0])
    await bot.fire(EventTopics.resource.save, { value })
  }

  const reemitDel = async ({ args, result }) => {
    const value = result || args[0]
    await bot.fire(EventTopics.resource.delete, { value })
  }

  bot.db.hook('put:post', reemitSave)
  bot.db.hook('update:post', reemitSave)
  // alias for update
  bot.db.hook('merge:post', reemitSave)
  bot.db.hook('del:post', reemitDel)

  const { events } = bot
  const fireAsync = async (event, data) => {
    const parsed = events.parseTopic(event)

    if (event.startsWith(EventTopics.resource.save.toString())) {
      await bot._fireSaveEvent({
        async: true,
        change: data
      })

      return
    }

    if (event.startsWith(EventTopics.message.mixed.toString())) {
      await bot._fireMessagesRaw({
        messages: [data].map(m => m.message),
        async: true
      })

      return
    }

    const newEvent = EventTopic.parse(event).async
    await bot.fire(newEvent, data)
  }

  bot.hook('*', async ({ ctx, event }, next) => {
    await next()
    const parsed = bot.events.parseTopic(event)
    if (parsed.batch) {
      console.warn(`batch events not re-emitted async at this time`, event)
      return
    }

    // ignore async events
    if (parsed.async) return

    // re-emit sync events as async
    await wait(0)
    // no `await` here as it causes circular dep in locks in bot
    bot.tasks.add({
      name: `simulate:stream:${event}`,
      promise: fireAsync(event, ctx.event).catch(err => {
        console.error(err.stack)
        throw err
      })
    })
  })
}
