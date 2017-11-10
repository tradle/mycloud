
module.exports = function getTables ({ resources, dbUtils }) {
  const { getTable } = dbUtils

  function loadTable (name) {
    if (!tables[name]) {
      tables[name] = getTable(resources.Table[name])
    }
  }

  const tables = {}
  Object.keys(resources.Table).forEach(loadTable)
  return tables
}
