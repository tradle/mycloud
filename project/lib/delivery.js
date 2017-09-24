const { EventEmitter } = require('events')
const inherits = require('inherits')
const debug = require('debug')('tradle:sls:delivery')
const DeliveryMQTT = require('./delivery-mqtt')
const DeliveryHTTP = require('./delivery-http')
const { co, clone, pick, bindAll } = require('./utils')
const Errors = require('./errors')
const MAX_BATCH_SIZE = 5

module.exports = Delivery

function Delivery (opts) {
  EventEmitter.call(this)
  bindAll(this)

  const { friends, messages } = opts
  this.messages = messages
  this.friends = friends
  this.http = new DeliveryHTTP(opts)
  this.mqtt = new DeliveryMQTT(opts)
}

const proto = Delivery.prototype
inherits(Delivery, EventEmitter)

proto.deliverMessages = co(function* (opts) {
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

    let messages = yield this.messages.getMessagesTo({
      recipient,
      gt,
      afterMessage,
      limit: batchSize,
      body: true,
    })

    debug(`found ${messages.length} messages for ${recipient}`)
    if (!messages.length) return

    yield this.deliverBatch(clone(opts, { messages }))

    // while (messages.length) {
    //   let message = messages.shift()
    //   yield deliverMessage({ clientId, recipient, message })
    // }

    let last = messages[messages.length - 1]
    afterMessage = pick(last, ['_recipient', 'time'])
  }
})

proto.deliverBatch = withTransport('deliverBatch')
proto.ack = withTransport('ack')
proto.reject = withTransport('reject')

proto.getTransport = co(function* (opts) {
  const { method, recipient, clientId } = opts
  if (clientId || !(method in this.http)) {
    return this.mqtt
  }

  if (!(method in this.mqtt)) {
    return this.http
  }

  try {
    opts.friend = yield this.friends.get({ permalink: recipient })
    return this.http
  } catch (err) {
    if (err.name !== 'NotFound') {
      throw err
    }

    return this.mqtt
  }
})

function withTransport (method) {
  return co(function* (opts) {
    const transport = yield this.getTransport(clone(opts, { method }))
    return transport[method](opts)
  })
}
