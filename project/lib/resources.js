
const debug = require('debug')('tradle:sls:Resources')
const ENV = require('./env')
const {
  SERVERLESS_SERVICE_NAME,
  SERVERLESS_STAGE
} = ENV

const RESOURCE_REGEX = /^R_([^_]*)_(.*)/
const upperFirst = str => str.charAt(0).toUpperCase() + str.slice(1)
const Resources = {}

Object.keys(ENV)
  .map(key => {
    const match = RESOURCE_REGEX.exec(key)
    if (!match) return

    let type = match[1].toLowerCase()
    type = type === 'restapi'
      ? 'RestAPI'
      : upperFirst(type)

    return {
      key,
      type,
      name: match[2]
    }
  })
  .filter(truthy)
  .forEach(register)

function register ({ key, type, name }) {
  if (!Resources[type]) {
    Resources[type] = {}
  }

  const value = type === 'RestAPI'
    ? `https://${ENV[key]}.execute-api.us-east-1.amazonaws.com/${SERVERLESS_STAGE}/${SERVERLESS_SERVICE_NAME}`
    : ENV[key]

  debug(`registered ${type} ${name} -> ${value}`)
  Resources[type][name] = value
}

function truthy (obj) {
  return !!obj
}

module.exports = Resources

