
const Resources = require('./resources')
const { getTable } = require('./db-utils')
const tables = {}

function loadTable (name) {
  if (!tables[name]) {
    tables[name] = getTable(Resources.Table[name])
  }
}

function update () {
  Object.keys(Resources.Table).forEach(loadTable)
}

Resources.on('change', update)
update()

module.exports = tables
