
const ENV = require('./env')
const { getTable } = require('./db-utils')
const { toCamelCase } = require('./utils')
const tables = {}

for (let prop in ENV) {
  if (prop.endsWith('_TABLE')) {
    let name = toCamelCase(prop, '_', true)
    tables[name] = getTable(ENV[prop])
  }
}

module.exports = tables
