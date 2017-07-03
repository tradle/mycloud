const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:Resources')
const { RESOURCES_ENV_PATH } = require('./env')
const { ENV_RESOURCE_PREFIX } = require('./constants')
const Resources = new EventEmitter()
Resources.Function = {}
Resources.Bucket = {}
Resources.Table = {}
Resources.Role = {}

Resources.isMappedType = function (resourceType) {
  return deflateResourceType(resourceType) in Resources
}

Resources.set = function (vars) {
  for (let varName in vars) {
    let mapping = Resources.fromEnvironmentMapping(varName, vars[varName])
    if (!mapping) continue

    let { type, key, value } = mapping
    let cache = Resources[type]
    if (cache) {
      cache[key] = value
      debug(`mapped ${type} ${key}`)
    } else {
      debug(`not mapping resource ${type}`)
    }
  }

  Resources.emit('change')
}

Resources.environment = function () {
  const env = {}
  for (let ResourceType in Resources) {
    let typed = Resources[ResourceType]
    for (let LogicalResourceId in typed) {
      let PhysicalResourceId = typed[LogicalResourceId]
      let { key, value } = Resources.toEnvironmentMapping({
        ResourceType,
        PhysicalResourceId,
        LogicalResourceId
      })

      env[key] = value
    }
  }

  return env
}

Resources.environmentForStack = function ({ StackResourceSummaries }) {
  const env = {}
  StackResourceSummaries
    .filter(({ ResourceType }) => Resources.isMappedType(ResourceType))
    .forEach(summary => {
      const { key, value } = Resources.toEnvironmentMapping(summary)
      env[key] = value
    })

  return env
}

Resources.toEnvironmentMapping = function ({
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

Resources.fromEnvironmentMapping = function (key, value) {
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
  const rEnd = require(RESOURCES_ENV_PATH)
  Resources.set(rEnd)
} catch (err) {
  debug('environment Resources file not found')
}

Resources.set(process.env)

module.exports = Resources
