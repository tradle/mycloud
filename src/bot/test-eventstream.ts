import { Bot } from '../types'
import {
  wait
} from '../utils'


export const simulateEventStream = (bot: Bot) => {
  bot.objects.hook('put', async (ctx, next) => {
    await next()
    await wait(0)
    await bot.fire('save', { value: ctx.event })
  })

  const { events } = bot
  const fire = async (event, data, batch) => {
    if (!event.startsWith('save')) {
      await bot.fire(events.toAsyncEvent(events.toBatchEvent(event)), data)
      return
    }

    if (batch) {
      await bot._fireSaveBatchEvent({
        async: true,
        changes: data,
        spread: false
      })
    } else {
      await bot._fireSaveEvent({
        async: true,
        change: data
      })
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
        return fire(event, payloads, true)
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
    if (parsed.async) {
      if (!parsed.batch) {
        enqueue(parsed.original, ctx.event)
      }

      return
    }

    await fire(event, ctx.event, false)
  })
}
