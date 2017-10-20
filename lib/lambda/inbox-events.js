const replicator = require('../replicator')
// replicate Inbox to Events
exports.handler = replicator.toEvents(item => {
  if (item._payloadType !== 'tradle.Message') {
    return {
      topic: 'receive',
      data: item
    }
  }
})
