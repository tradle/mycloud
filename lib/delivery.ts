import { EventEmitter } from 'events'
import * as inherits from 'inherits'
import * as DeliveryMQTT from './delivery-mqtt'
import * as DeliveryHTTP from './delivery-http'
import { clone, pick, bindAll } from './utils'
import * as Errors from './errors'

const debug = require('debug')('tradle:sls:delivery')
const MAX_BATCH_SIZE = 5

function withTransport (method: string) {
  return async function (opts: any) {
    opts = { ...opts, method }
    const transport = await this.getTransport(opts)
    return transport[method](opts)
  }
}

class Delivery extends EventEmitter {
  mqtt: any
  http: any
  friends: any
  messages: any
  constructor (opts) {
    super()

    const { friends, messages } = opts
    this.messages = messages
    this.friends = friends
    this.http = new DeliveryHTTP(opts)
    this.mqtt = new DeliveryMQTT(opts)
  }

  deliverBatch = withTransport('deliverBatch')
  ack = withTransport('ack')
  reject = withTransport('reject')

  async deliverMessages (opts) {
    opts = clone(opts)
    let {
      recipient,
      gt=0,
      lt=Infinity,
      afterMessage
    } = opts

    debug(`looking up messages for ${recipient} > ${gt}`)
    while (true) {
      let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
      if (batchSize <= 0) return

      let messages = await this.messages.getMessagesTo({
        recipient,
        gt,
        afterMessage,
        limit: batchSize,
        body: true,
      })

      debug(`found ${messages.length} messages for ${recipient}`)
      if (!messages.length) return

      await this.deliverBatch(clone(opts, { messages }))

      // while (messages.length) {
      //   let message = messages.shift()
      //   await deliverMessage({ clientId, recipient, message })
      // }

      let last = messages[messages.length - 1]
      afterMessage = pick(last, ['_recipient', 'time'])
    }
  }

  async getTransport (opts: {
    method: string,
    recipient: string,
    clientId?: string,
    friend?: any
  }) {
    const { method, recipient, clientId, friend } = opts
    if (clientId || !(method in this.http)) {
      return this.mqtt
    }

    if (friend || !(method in this.mqtt)) {
      return this.http
    }

    try {
      opts.friend = await this.friends.get({ permalink: recipient })
      return this.http
    } catch (err) {
      debug(`cannot determine transport to use for recipient ${recipient}`)
      throw err
    }
  }
}

export = Delivery
