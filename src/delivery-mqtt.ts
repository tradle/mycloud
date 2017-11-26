const { EventEmitter } = require('events')
const inherits = require('inherits')
const debug = require('debug')('tradle:sls:delivery-mqtt')
const { SEQ } = require('@tradle/constants')
const { co, typeforce, pick } = require('./utils')
const Errors = require('./errors')
const { omitVirtual, extend, batchStringsBySize, bindAll } = require('./utils')
const { getLink } = require('./crypto')
// 128KB, but who knows what overhead MQTT adds, so leave a buffer
// would be good to test it and know the hard limit
const MAX_PAYLOAD_SIZE = 115000

module.exports = Delivery

function Delivery ({ env, iot, messages, objects }) {
  EventEmitter.call(this)
  bindAll(this)

  this.env = env
  this.iot = iot
  this.messages = messages
  this.objects = objects
  this._parentTopic = env.IOT_PARENT_TOPIC
}

const proto = Delivery.prototype
// eventemitter makes testing easier
inherits(Delivery, EventEmitter)

proto._prefixTopic = function _prefixTopic (topic) {
  return `${this._parentTopic}/${topic}`
}

proto._unprefixTopic = function _unprefixTopic (topic) {
  return topic.slice(this._parentTopic.length + 1)
}

proto.includesClientMessagesTopic = function includesClientMessagesTopic ({
  clientId,
  topics
}) {
  const catchAllTopic = `${clientId}/sub/+`
  const messagesTopic = `${clientId}/sub/inbox`
  return topics
    .map(topic => this._unprefixTopic(topic))
    .find(topic => topic === messagesTopic || topic === catchAllTopic)
}


proto.deliverBatch = co(function* ({ clientId, recipient, messages }) {
  const seqs = messages.map(m => m[SEQ])
  debug(`delivering ${messages.length} messages to ${recipient}: ${seqs.join(', ')}`)
  const strings = messages.map(stringify)
  const subBatches = batchStringsBySize(strings, MAX_PAYLOAD_SIZE)
  for (let subBatch of subBatches) {
    yield this.emit({
      clientId,
      topic: 'inbox',
      payload: `{"messages":[${subBatch.join(',')}]}`
    })
  }

  debug(`delivered ${messages.length} messages to ${recipient}`)
})

proto.ack = function ack ({ clientId, message }) {
  debug(`acking message from ${clientId}`)
  const stub = this.messages.getMessageStub({ message })
  return this.emit({
    clientId,
    topic: 'ack',
    payload: {
      message: stub
    }
  })
}

proto.reject = function reject ({ clientId, message, error }) {
  debug(`rejecting message from ${clientId}`, error)
  const stub = this.messages.getMessageStub({ message, error })
  return this.emit({
    clientId,
    topic: 'reject',
    payload: {
      message: stub,
      reason: Errors.export(error)
    }
  })
}

proto.emit = function emit ({ clientId, topic, payload }) {
  return this.iot.publish({
    topic: this._prefixTopic(`${clientId}/sub/${topic}`),
    payload
  })
}

function stringify (msg) {
  return JSON.stringify(omitVirtual(msg))
}
