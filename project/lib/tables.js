
const ENV = require('./env')
const { getTable } = require('./db-utils')
const { toCamelCase } = require('./string-utils')
const tables = {}

Object.keys(ENV)
  .filter(prop => prop.endsWith('_TABLE'))
  .forEach(prop => {
    const name = toCamelCase(prop, '_', true)
    tables[name] = getTable(ENV[prop])
  })

module.exports = tables
