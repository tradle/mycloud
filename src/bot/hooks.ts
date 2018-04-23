// @ts-ignore
import Promise from 'bluebird'
import { groupBy, chunk } from 'lodash'
import { TYPE } from '@tradle/constants'
import { Bot, Seal } from '../types'
import {
  batchProcess,
  pluck,
  RESOLVED_PROMISE
} from '../utils'

import { getSealEventTopic, topics as EventTopics } from '../events'
import { TYPES } from '../constants'

const { SEAL_STATE, DELIVERY_ERROR } = TYPES

// TODO: split these up into hooks-sync, hooks-async
export const hookUp = (bot: Bot) => {
  // backwards compat
  bot.hookSimple(EventTopics.message.inbound.sync, event => bot.fire('message', event))
  bot.hookSimple(EventTopics.resource.save.async.batch, async (changes) => {
    await bot.events.putEvents(bot.events.fromSaveBatch(changes))

    const sealChanges = changes
      .filter(change => change.value && change.value[TYPE] === SEAL_STATE)

    const deliveryErrs = changes
      .filter(change => change.value && change.value[TYPE] === DELIVERY_ERROR)
      .map(change => change.value)

    try {
      await Promise.all([
        bot.backlinks.processChanges(changes),
        sealChanges.length ? reemitSealEvents(sealChanges) : RESOLVED_PROMISE,
        deliveryErrs.length ? reemitDeliveryErrorEvents(deliveryErrs) : RESOLVED_PROMISE,
      ])
    } catch (err) {
      bot.logger.error('failed to process resource changes batch', err)
      throw err
    }
  })

  bot.hookSimple(EventTopics.message.inbound.async.batch, async (msgs) => {
    await bot.backlinks.processMessages(pluck(msgs, 'message'))
  })

  bot.hookSimple(EventTopics.message.outbound.async.batch, async (msgs) => {
    await bot.backlinks.processMessages(pluck(msgs, 'message'))
  })

  const retryDelivery = async (deliveryErr) => {
    const { counterparty, time } = deliveryErr
    const friend = await bot.friends.getByIdentityPermalink(counterparty)
    let deleted
    const onProgress = async () => {
      if (!deleted) {
        await bot.delivery.http.deleteError(deliveryErr)
        deleted = true
      }
    }

    await bot.delivery.deliverMessages({
      friend,
      recipient: counterparty,
      onProgress,
      range: {
        after: time - 1
      }
    })
  }

  bot.hookSimple(EventTopics.delivery.error.async.batch, async (deliveryErrs) => {
    await Promise.map(deliveryErrs, retryDelivery)
  })

  const reemitDeliveryErrorEvents = async (errors) => {
    await bot._fireDeliveryErrorBatchEvent({ errors, async: true })
  }

  const reemitSealEvents = async (changes) => {
    const events = changes.map(toSealEvent)
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
            seals: subset.map(({ data }) => data),
            async: true,
            spread: true
          })
        }))
      }
    })
  }
}

const toSealEvent = record => ({
  event: getSealEventTopic({ old: record.old, new: record.value }).async,
  data: <Seal>record.value
})
