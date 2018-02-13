import { Env } from './types'

const { ENV_RESOURCE_PREFIX } = require('./constants')
const RESOURCE_REGEX = new RegExp(`^${ENV_RESOURCE_PREFIX}([^_]*)(?:_(.*))?$`)

export = function resourcesForEnv ({ env }: { env: Env }) {
  const { logger } = env
  const {
    SERVERLESS_SERVICE_NAME,
    SERVERLESS_STAGE,
    IS_OFFLINE
  } = env

  const upperFirst = str => str.charAt(0).toUpperCase() + str.slice(1)
  const resources = {}

  Object.keys(env)
    .map(key => {
      const match = RESOURCE_REGEX.exec(key)
      if (!match) return

      let type = match[1].toLowerCase()
      type = type === 'restapi'
        ? 'RestApi'
        : upperFirst(type)

      return {
        key,
        type,
        name: match[2] || ''
      }
    })
    .filter(truthy)
    .forEach(register)

  function register ({ key, type, name }) {
    if (!resources[type]) {
      resources[type] = {}
    }

    let value
    if (type === 'RestApi') {
      if (env.IS_OFFLINE) {
        value = require('./cli/utils').getOfflineHost(env)
      } else {
        value = `https://${env[key]}.execute-api.us-east-1.amazonaws.com/${SERVERLESS_STAGE}`
      }

    } else {
      value = env[key]
      if (value && value.Ref && env.IS_OFFLINE) {
        value = value.Ref
      }
    }

    logger.silly(`registered ${type} ${name} -> ${value}`)
    if (name) {
      resources[type][name] = value
    } else {
      // only Stack really
      resources[type] = value
    }
  }

  function truthy (obj) {
    return !!obj
  }

  return resources
}
