import { TYPE } from '@tradle/constants'
import isEqual from 'lodash/isEqual'
import { Bot } from './types'
import {
  wait
} from './utils'

import { EventTopic, topics as EventTopics } from './events'
import { createMiddleware as createMessageMiddleware } from './middleware/onmessagestream'

/**
 * Set up processing that's usually done asynchronously on DynamoDB Stream
 * Re-emit various events as 'async' and/or 'batch'
 */
export const simulateEventStream = (bot: Bot) => {
  // bot.objects.hook('put', async (ctx, next) => {
  //   await next()
  //   await wait(0)
  //   await bot.fire('save', { value: ctx.event })
  // })

  const reemitSave = async ({ args, result }) => {
    if (args[0][TYPE] === 'tradle.IotSession') {
      bot.logger.debug('not re-emitting IotSession event, too taxing in dev env')
      return
    }

    // await next()
    // await wait(0)
    // await bot.fire('save', { value: ctx.event })
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

  bot.hook(EventTopics.message.stream.batch.async, createMessageMiddleware(bot))
  bot.hook(EventTopics.message.stream.async, createMessageMiddleware(bot))

  const { events } = bot
  const fireAsync = async (event, data, batch) => {
    // avoid infinite loop
    if (event.startsWith(EventTopics.message.stream.toString())) return

    const parsed = events.parseTopic(event)
    // if (parsed.batch === batch) return

    let payload
    if (parsed.batch === batch) {
      payload = data
    } else if (batch) {
      payload = [].concat(data)
    } else {
      payload = data[0]
    }

    if (event.startsWith(EventTopics.message.mixed.toString())) {
      // emit batch stream event
      // other message events are re-emitted by middleware after pre-processing
      if (batch) {
        payload = payload.map(m => bot.messages.formatForDB(m.message))
        await bot.fire(EventTopics.message.stream.async.batch, payload)
      }

      return
    }

    if (event.startsWith(EventTopics.resource.save.toString())) {
      if (batch) {
        await bot._fireSaveBatchEvent({
          async: true,
          changes: payload
        })
      } else {
        await bot._fireSaveEvent({
          async: true,
          change: payload
        })
      }

      return
    }

    const newEvent = EventTopic.parse(event).async
    if (batch) {
      await bot.fire(newEvent.batch, payload)
    } else {
      await bot.fire(newEvent, payload)
    }
  }

  // trigger stream stuff
  const batches = {}
  let batchPromise = Promise.resolve()
  const scheduleBatch = event => {
    clearTimeout(batches[event].timeout)
    batches[event].timeout = setTimeout(() => {
      const payloads = batches[event].payloads.slice()
      batches[event].payloads.length = 0
      // preserve order
      batchPromise = batchPromise.then(() => {
        return fireAsync(event, payloads, true)
      })
    }, 300)
  }

  const enqueue = (event, payload) => {
    if (!batches[event]) {
      batches[event] = {
        timeout: null,
        payloads: []
      }
    }

    batches[event].payloads.push(payload)
    scheduleBatch(event)
  }

  bot.hook('*', async ({ ctx, event }, next) => {
    await next()
    await wait(0)
    const parsed = bot.events.parseTopic(event)
    if (parsed.async) return

    const payload = ctx.event
    if (parsed.batch) {
      // re-emit as async batch
      // console.log('WILL RE-EMIT ASYNC', event)
      await fireAsync(event, payload, true)
    } else {
      // enqueue to re-emit as async batch
      // console.log('WILL RE-EMIT AS ASYNC BATCH', event)
      enqueue(event, payload)
      // fire async non-batch
      // console.log('WILL RE-EMIT ASYNC', event)
      await fireAsync(event, payload, false)
    }
  })
}
