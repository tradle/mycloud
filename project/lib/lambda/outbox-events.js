const debug = require('debug')('λ:outbox-events')
const replicator = require('../replicator')
// replicate Inbox to EventsTable

exports.handler = replicator.toEvents(item => {
  return {
    topic: 'send',
    data: item
  }
})
