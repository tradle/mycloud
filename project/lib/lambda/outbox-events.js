const debug = require('debug')('λ:outbox-events')
const replicator = require('../replicator')
// replicate Inbox to Events

exports.handler = replicator.toEvents(item => {
  return {
    topic: 'send',
    data: item
  }
})
