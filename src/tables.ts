
import { Tables } from './types'

export const getTables = ({ serviceMap, dbUtils }) => {
  const { getTable } = dbUtils

  function loadTable (name) {
    if (!tables[name]) {
      tables[name] = getTable(serviceMap.Table[name])
    }
  }

  const tables = <Tables>{}
  Object.keys(serviceMap.Table).forEach(loadTable)
  return tables
}
