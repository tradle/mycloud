
const Resources = require('./resources')
const { getTable } = require('./db-utils')

function loadTable (name) {
  if (!tables[name]) {
    tables[name] = getTable(Resources.Table[name])
  }
}

const tables = {}
Object.keys(Resources.Table).forEach(loadTable)

module.exports = tables
