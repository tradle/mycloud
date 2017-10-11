const replicator = require('../replicator')
// replicate Inbox to Events
exports.handler = replicator.toEvents(change => {
  return {
    topic: getSealEventTopic(change),
    data: change.new
  }
}, true)

// for testing
exports.getSealEventTopic = getSealEventTopic

function getSealEventTopic(change) {
  if (change.old) {
    if (change.old.unsealed) {
      return 'seal:wrote'
    }
    if (change.new.confirmations > 0) {
      return 'seal:confirm'
    }
    return 'seal:read'
  }
  if (change.new.unsealed) {
    return 'seal:write'
  }
  return 'seal:watch'
}
