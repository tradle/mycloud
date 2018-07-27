import { Env, IServiceMap } from './types'
import { ENV_RESOURCE_PREFIX } from './constants'

const RESOURCE_REGEX = new RegExp(`^${ENV_RESOURCE_PREFIX}([^_]*)(?:_(.*))?$`)

export const createServiceMap = ({ env }: { env: Env }):IServiceMap => {
  const { logger } = env
  const {
    AWS_REGION,
    SERVERLESS_SERVICE_NAME,
    SERVERLESS_STAGE,
    IS_OFFLINE
  } = env

  const upperFirst = str => str.charAt(0).toUpperCase() + str.slice(1)
  const resources = {} as IServiceMap

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
      if (env.TESTING) {
        value = {
          id: '',
          url: require('./cli/utils').getOfflineHost(env)
        }
      } else {
        value = {
          id: env[key],
          url: `https://${env[key]}.execute-api.${AWS_REGION}.amazonaws.com/${SERVERLESS_STAGE}`
        }
      }
    } else {
      value = env[key]
      if (value && value.Ref && env.TESTING) {
        value = value.Ref
      }
    }

    logger.ridiculous(`registered ${type} ${name} -> ${JSON.stringify(value)}`)
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
