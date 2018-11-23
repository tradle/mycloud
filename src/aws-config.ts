import Env from './env'
import { IAWSServiceConfig } from './types'

export const createConfig = ({ region, local } : {
  region: string
  local?: boolean
}):IAWSServiceConfig => {
  const services = {
    maxRetries: 6,
    region,
    s3: {
      signatureVersion: 'v4',
    },
    iotdata: {
      httpOptions: {
        connectTimeout: 10000,
        timeout: 10000,
      }
    }
  } as IAWSServiceConfig

  if (local) {
    const localIP = require('localip')()
    const localstackEndpoints = require('./test/localstack')

    for (let name in localstackEndpoints) {
      let lname = name.toLowerCase()
      if (!services[lname]) services[lname] = { region }

      let endpoint = localstackEndpoints[name]
      services[lname].endpoint = endpoint.replace(/localhost/, localIP)
    }

    services.s3.s3ForcePathStyle = true
  }

  return services
}
