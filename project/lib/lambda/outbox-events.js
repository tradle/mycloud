const debug = require('debug')('tradle:sls:λ:outbox-events')
const replicator = require('../replicator')
// replicate Inbox to EventsTable

exports.handler = replicator.toEvents(item => {
  return {
    topic: 'send',
    data: item
  }
})
