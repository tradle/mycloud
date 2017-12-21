// @ts-ignore
import Promise = require('bluebird')
import {
  cloneDeep,
  isEqual
} from 'lodash'

import IotMessage = require('@tradle/iot-message')
import { TYPE } from '@tradle/constants'
import { addLinks } from '../../crypto'
import { createLocker } from '../locker'
import { groupBy, allSettled } from '../../utils'
import {
  getMessagePayload,
  getMessageGist,
  savePayloadToDB
} from '../utils'

import { EventSource } from '../../lambda'

export const preProcessIotMessage = (lambda, opts) => {
  const { logger, tradle, tasks, isUsingServerlessOffline } = lambda
  const { user } = tradle

  tasks.add({
    name: 'getiotendpoint',
    promiser: tradle.iot.getEndpoint
  })

  return async (ctx, next) => {
    const { event, context } = ctx
    let { topic, clientId, data } = event
    if (!clientId && isUsingServerlessOffline) {
      // serverless-offline support
      clientId = topic.match(/\/([^/]+)\/[^/]+/)[1]
    }

    const buf = typeof data === 'string' ? new Buffer(data, 'base64') : data
    let messages
    try {
      const payload = await IotMessage.decode(buf)
      messages = JSON.parse(payload.toString()).messages
    } catch (err) {
      logger.error('client sent invalid MQTT payload', err.stack)
      await user.onIncompatibleClient({ clientId })
      return
    }

    ctx.messages = await user.onSentMessages({ clientId, messages })
    if (ctx.messages.length) {
      logger.debug('preprocessed messages')
      await next()
    }
  }
}

/**
 * runs after the inbound message has been written to inbox
 */
export const onmessage = (lambda, opts) => {
  const { autosave=true } = opts
  const { bot, tradle, tasks, logger, isTesting } = lambda
  const locker = createLocker({
    name: 'inbound message lock',
    debug: lambda.logger.sub('lock:receive').debug,
    timeout: lambda.isTesting ? null : 10000
  })

  const lock = id => locker.lock(id)
  const unlock = id => locker.unlock(id)
  tasks.add({
    name: 'getiotendpoint',
    promiser: tradle.iot.getEndpoint
  })

  return async (ctx, next) => {
    const { messages } = ctx
    if (!messages) return

    const byUser = groupBy(messages, '_author')
    await allSettled(Object.keys(byUser).map(async (userId) => {
      let botMessageEvent
      const batch = byUser[userId]
      await lock(userId)
      try {
        let userPre = await bot.users.createIfNotExists({ id: userId })
        let user = cloneDeep(userPre)
        for (const message of batch) {
          if (bot.isTesting) {
            await savePayloadToDB({ bot, message })
          }

          botMessageEvent = toBotMessageEvent({ bot, user, message })
          await bot.hooks.fire('message', botMessageEvent)
        }

        user = botMessageEvent.user
        if (isEqual(user, userPre)) {
          logger.debug('user state was not changed by onmessage handler')
        } else {
          logger.debug('merging changes to user state')
          await bot.users.merge(user)
        }
      } finally {
        await unlock(userId)
      }
    }))

    await next()
  }
}

const toBotMessageEvent = ({ bot, user, message }):any => {
  // identity permalink serves as user id
  const payload = message.object
  const type = payload[TYPE]
  return {
    bot,
    user,
    message,
    payload,
    type,
    link: payload._link,
    permalink: payload._permalink,
  }
}
