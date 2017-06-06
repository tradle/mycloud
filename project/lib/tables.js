
const ENV = require('./env')
const { getTable } = require('./db-utils')
const tables = {}

;[
  'InboxTable',
  'OutboxTable',
  'PresenceTable',
  'PubKeysTable',
  'EventsTable',
].forEach(TableName => {
  if (ENV[TableName]) {
    tables[TableName] = getTable(ENV[TableName])
  }
})

module.exports = tables
