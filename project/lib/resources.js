
const debug = require('debug')('tradle:sls:Resources')
const ENV = require('./env')
const RESOURCE_REGEX = /^R_([^_]*)_(.*)/
const upperFirst = str => str.charAt(0).toUpperCase() + str.slice(1)
const Resources = {}

Object.keys(ENV)
  .map(key => {
    const match = RESOURCE_REGEX.exec(key)
    return match && {
      key,
      type: upperFirst(match[1].toLowerCase()),
      name: match[2]
    }
  })
  .filter(truthy)
  .forEach(register)

function register ({ key, type, name }) {
  if (!Resources[type]) {
    Resources[type] = {}
  }

  debug(`registered ${type} ${name} -> ${ENV[key]}`)
  Resources[type][name] = ENV[key]
}

function truthy (obj) {
  return !!obj
}

module.exports = Resources

