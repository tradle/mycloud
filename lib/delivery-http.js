const { EventEmitter } = require('events')
const inherits = require('inherits')
const debug = require('debug')('tradle:sls:delivery-http')
const { co, post, bindAll } = require('./utils')
// const RESOLVED = Promise.resolve()
// const promiseNoop = () => RESOLVED

module.exports = Delivery

function Delivery (opts) {
  EventEmitter.call(this)
  bindAll(this)
}

const proto = Delivery.prototype
inherits(Delivery, EventEmitter)

proto.deliverBatch = co(function* ({ friend, recipient, messages }) {
  const endpoint = `${friend.url}/inbox`
  yield post(endpoint, { messages })
})
