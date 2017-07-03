const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:resources')
const { RESOURCES_ENV_PATH } = require('./env')
const { ENV_RESOURCE_PREFIX } = require('./constants')
const resources = new EventEmitter()
resources.Function = {}
resources.Bucket = {}
resources.Table = {}
resources.Role = {}

resources.isMappedType = function (resourceType) {
  return deflateResourceType(resourceType) in resources
}

resources.set = function (vars) {
  for (let varName in vars) {
    let mapping = resources.fromEnvironmentMapping(varName, vars[varName])
    if (!mapping) continue

    let { type, key, value } = mapping
    let cache = resources[type]
    if (cache) {
      cache[key] = value
      debug(`mapped ${type} ${key}`)
    } else {
      debug(`not mapping resource ${type}`)
    }
  }

  resources.emit('change')
}

resources.environment = function () {
  const env = {}
  for (let ResourceType in resources) {
    let typed = resources[ResourceType]
    for (let LogicalResourceId in typed) {
      let PhysicalResourceId = typed[LogicalResourceId]
      let { key, value } = resources.toEnvironmentMapping({
        ResourceType,
        PhysicalResourceId,
        LogicalResourceId
      })

      env[key] = value
    }
  }

  return env
}

resources.toEnvironmentMapping = function ({
  ResourceType,
  PhysicalResourceId,
  LogicalResourceId
}) {
  ResourceType = deflateResourceType(ResourceType)
  return {
    key: `${ENV_RESOURCE_PREFIX}${ResourceType}_${LogicalResourceId}`,
    value: PhysicalResourceId
  }
}

resources.fromEnvironmentMapping = function (key, value) {
  if (key.slice(0, ENV_RESOURCE_PREFIX.length) !== ENV_RESOURCE_PREFIX) {
    return
  }

  key = key.slice(ENV_RESOURCE_PREFIX.length)
  const uIdx = key.indexOf('_')
  return {
    type: key.slice(0, uIdx),
    key: key.slice(uIdx + 1),
    value
  }
}

function deflateResourceType (type) {
  // http://docs.aws.amazon.com/lambda/latest/dg/env_variables.html
  // environment variable name regex
  // /^[a-zA-Z]+[a-zA-Z0-9_]*/
  return type.slice(type.lastIndexOf(':') + 1)
}

try {
  const resources = require(RESOURCES_ENV_PATH)
  resources.set(resources)
} catch (err) {
  debug('environment resources file not found')
}

resources.set(process.env)

module.exports = resources
