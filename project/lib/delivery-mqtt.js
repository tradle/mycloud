const { EventEmitter } = require('events')
const inherits = require('inherits')
const debug = require('debug')('tradle:sls:delivery-mqtt')
const { co, typeforce, pick } = require('./utils')
const Errors = require('./errors')
const { omitVirtual, extend, batchStringsBySize, bindAll } = require('./utils')
const { getLink } = require('./crypto')
// 128KB, but who knows what overhead MQTT adds, so leave a buffer
// would be good to test it and know the hard limit
const MAX_PAYLOAD_SIZE = 126000

module.exports = Delivery

function Delivery ({ env, iot, messages, objects }) {
  EventEmitter.call(this)
  bindAll(this)

  this.env = env
  this.iot = iot
  this.messages = messages
  this.objects = objects
}

const proto = Delivery.prototype
// eventemitter makes testing easier
inherits(Delivery, EventEmitter)

proto.deliverBatch = co(function* ({ clientId, recipient, messages }) {
  debug(`delivering ${messages.length} messages to ${recipient}`)
  messages.forEach(object => this.objects.presignEmbeddedMediaLinks({ object }))
  const strings = messages.map(stringify)
  const subBatches = batchStringsBySize(strings, MAX_PAYLOAD_SIZE)
  for (let subBatch of subBatches) {
    yield this.iot.sendMessages({
      clientId,
      payload: `{"messages":[${subBatch.join(',')}]}`
    })
  }

  debug(`delivered ${messages.length} messages to ${recipient}`)
})

proto.ack = function ack ({ clientId, message }) {
  debug(`acking message from ${clientId}`)
  const stub = this.messages.getMessageStub({ message })
  return this.iot.publish({
    topic: `${clientId}/ack`,
    payload: {
      message: stub
    }
  })
}

proto.reject = function reject ({ clientId, message, error }) {
  debug(`rejecting message from ${clientId}`, error)
  const stub = this.messages.getMessageStub({ message, error })
  return this.iot.publish({
    topic: `${clientId}/reject`,
    payload: {
      message: stub,
      reason: Errors.export(error)
    }
  })
}

function stringify (msg) {
  return JSON.stringify(omitVirtual(msg))
}
