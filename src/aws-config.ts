import Env from './env'
import { IAWSServiceConfig } from './types'

export const createConfig = ({ env } : { env: Env }):IAWSServiceConfig => {
  const { IS_LOCAL, IS_OFFLINE } = env
  const services = {
    maxRetries: 6,
    region: process.env.AWS_REGION || 'us-east-1'
  } as IAWSServiceConfig

  if (IS_LOCAL || IS_OFFLINE) {
    const localIP = require('localip')()
    const localstackEndpoints = require('./test/localstack')

    for (let name in localstackEndpoints) {
      let lname = name.toLowerCase()
      if (!services[lname]) services[lname] = {}

      let endpoint = localstackEndpoints[name]
      services[lname].endpoint = endpoint.replace(/localhost/, localIP)
    }

    services.s3.s3ForcePathStyle = true
  }

  return services
}
