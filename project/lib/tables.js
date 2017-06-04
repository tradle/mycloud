
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
  tables[TableName] = getTable(TableName)
})

module.exports = tables
