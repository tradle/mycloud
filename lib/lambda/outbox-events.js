const replicator = require('../replicator')
// replicate Outbox to Events
exports.handler = replicator.toEvents(item => {
  if (item._payloadType !== 'tradle.Message') {
    return {
      topic: 'send',
      data: item
    }
  }
})
