// @ts-ignore
import Promise from 'bluebird'
import { groupBy, chunk } from 'lodash'
import { TYPE } from '@tradle/constants'
import { Bot, Seal, ISaveEventPayload } from './types'
import {
  batchProcess,
  pluck,
  RESOLVED_PROMISE
} from './utils'

import { getSealEventTopic, topics as EventTopics } from './events'
import { TYPES } from './constants'

const { SEAL_STATE, DELIVERY_ERROR } = TYPES

// TODO: split these up into hooks-sync, hooks-async
export const hookUp = (bot: Bot) => {
  // backwards compat
  bot.hookSimple(EventTopics.message.inbound.sync, event => bot.fire('message', event))

  // 1. save to immutable events table
  // 2. re-emit seal events, delivery error events, etc.
  bot.hookSimple(EventTopics.resource.save.async, async (change: ISaveEventPayload) => {
    const putEvents = bot.events.putEvents([
      bot.events.fromSaveEvent(change)
    ])

    const processBacklinks = bot.backlinks.processChanges([change])
    const tasks = [ putEvents, processBacklinks ]
    if (change.value) {
      const type = change.value[TYPE]
      if (type === SEAL_STATE) {
        tasks.push(reemitSealEvent(change))
      }
      // else if (type === DELIVERY_ERROR) {
      //   tasks.push(reemitDeliveryErrorEvent(change))
      // }
    }

    try {
      await Promise.all(tasks)
    } catch (err) {
      bot.logger.error('failed to process resource changes batch', err)
      throw err
    }
  })

  const processBacklinksForMessage = async (msg) => {
    await bot.backlinks.processMessages([msg.message])
  }

  bot.hookSimple(EventTopics.message.inbound.async, processBacklinksForMessage)
  bot.hookSimple(EventTopics.message.outbound.async, processBacklinksForMessage)

  // bot.hookSimple(EventTopics.message.inbound.async.batch, async (msgs) => {
  //   await bot.backlinks.processMessages(pluck(msgs, 'message'))
  // })

  // bot.hookSimple(EventTopics.message.outbound.async.batch, async (msgs) => {
  //   await bot.backlinks.processMessages(pluck(msgs, 'message'))
  // })

  const retryDelivery = async (deliveryErr) => {
    if (bot.delivery.http.isStuck(deliveryErr)) return

    const { counterparty } = deliveryErr
    await bot.delivery.deliverMessages({
      recipient: counterparty,
      range: bot.delivery.http.getRangeFromError(deliveryErr),
    })
  }

  bot.hookSimple(EventTopics.delivery.error.async, retryDelivery)

  const reemitDeliveryErrorEvent = async (change: ISaveEventPayload) => {
    const error = change.value
    await bot._fireDeliveryErrorEvent({ error, async: true })
  }

  const reemitDeliveryErrorEvents = async (changes: ISaveEventPayload[]) => {
    const errors = changes.map(change => change.value)
    await bot._fireDeliveryErrorBatchEvent({ errors, async: true })
  }

  const reemitSealEvent = async (change: ISaveEventPayload) => {
    return bot._fireSealEvent(toAsyncSealEvent(change))
  }

  const reemitSealEvents = async (changes) => {
    const events = changes.map(toAsyncSealEvent)
    await batchProcess({
      data: events,
      batchSize: 10,
      processBatch: async (batch) => {
        const byType = groupBy(events, 'event')

        // trigger batch processors
        await Promise.all(Object.keys(byType).map(async (event) => {
          const subset = byType[event]
          if (!subset) return

          await bot._fireSealBatchEvent({
            event,
            seals: subset.map(({ seal }) => seal),
            async: true,
            spread: true
          })
        }))
      }
    })
  }
}

const toAsyncSealEvent = record => ({
  event: getSealEventTopic(record).async.toString(),
  seal: record.value as Seal,
  async: true
})
