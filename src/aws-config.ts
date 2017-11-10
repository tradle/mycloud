import Env from './env'

export const createConfig = ({ env } : { env: Env }) => {
  const { TESTING } = env
  const services = {
    maxRetries: 6,
    region: process.env.AWS_REGION || 'us-east-1'
  }

  if (TESTING) {
    const localstackEndpoints = require('./test/localstack')

    for (let name in localstackEndpoints) {
      let lname = name.toLowerCase()
      if (!services[lname]) services[lname] = {}

      services[lname].endpoint = localstackEndpoints[name]
    }

    services.s3.s3ForcePathStyle = true
  }

  return services
}
