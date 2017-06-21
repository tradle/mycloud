const debug = require('debug')('λ:inbox-events')
const replicator = require('../replicator')
// replicate Inbox to EventsTable

exports.handler = replicator.toEvents(item => {
  return {
    topic: 'receive',
    data: item
  }
})
