const replicator = require('../replicator')
// replicate Inbox to Events
exports.handler = replicator.toEvents(item => {
  return {
    topic: 'receive',
    data: item
  }
})
