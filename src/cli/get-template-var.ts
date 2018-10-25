import get from 'lodash/get'

const defaults = require('../../vars.json')
const vars = require('../../default-vars.json')

export const getVar = (path: string) => {
  const fallback = get(defaults, path)
  return get(vars, path, fallback)
}

export const getVars = (names: string[]):any => names.reduce((map, name) => {
  map[name] = getVar(name)
  return map
}, {})
