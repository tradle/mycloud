import withDefaults from 'lodash/defaults'

const defaults = require('../../vars.json')
const vars = require('../../default-vars.json')

export const getVar = (name: string) => {
  return withDefaults(vars, defaults)[name]
}

export const getVars = (names: string[]):any => names.reduce((map, name) => {
  map[name] = getVar(name)
  return map
}, {})
