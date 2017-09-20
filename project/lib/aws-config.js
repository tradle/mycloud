const services = {
  maxRetries: 6,
  region: process.env.AWS_REGION || 'us-east-1'
}

if (process.env.IS_LOCAL || process.env.NODE_ENV === 'test') {
  const localstack = require('../test/localstack')

  for (let name in localstack) {
  let lname = name.toLowerCase()
  if (!services[lname]) services[lname] = {}

  services[lname].endpoint = localstack[name]
  }

  services.s3.s3ForcePathStyle = true
}

module.exports = services
