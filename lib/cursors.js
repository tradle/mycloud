const { unmarshalDBItem } = require('./db-utils')

const prefixToEvent = {
  s_: 'seal',
  m_: 'message'
}

function parseQueueId (id) {
  for (let prefix in prefixToEvent) {
    if (id.slice(0, prefix.length) === prefix) {
      return {
        event: prefixToEvent[prefix],
        queue: id.slice(prefix.length)
      }
    }
  }
}

function parseCursorRecords (records) {
  const changes = records.map(record => {
    return {
      old: unmarshalDBItem(record.dynamodb.OldImage),
      new: unmarshalDBItem(record.dynamodb.NewImage)
    }
  })

  const queueId = changes[0].old.queue
  const parsed = parseQueueId(queueId)
  if (!parsed) {
    throw new Error(`failed to parse queue id: ${queueId}`)
  }

  parsed.changes = changes
  return parsed
}

module.exports = {
  parseCursorRecords
}
