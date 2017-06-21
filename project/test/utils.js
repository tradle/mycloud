const { co } = require('../lib/utils')
const { getTable, marshalDBItem } = require('../lib/db-utils')

const recreateTable = co(function* (schema) {
  const table = getTable(schema.TableName)
  try {
    yield table.destroy()
  } catch (err) {}

  yield table.create(schema)
  return table
})

function toStreamItems (changes) {
  return {
    Records: [].concat(changes).map(change => {
      return {
        dynamodb: {
          NewImage: marshalDBItem(change.new),
          OldImage: change.old && marshalDBItem(change.old)
        }
      }
    })
  }
}

module.exports = {
  recreateTable,
  toStreamItems
}
