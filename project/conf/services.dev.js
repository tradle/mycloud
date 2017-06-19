const localstack = require('./localstack')
const services = {
  "maxRetries": 6,
  "AWS": {
    "region": "us-east-1"
  },
  "S3": {
    "s3ForcePathStyle": true
  }
}

for (let name in localstack) {
  if (!services[name]) services[name] = {}

  services[name].endpoint = localstack[name]
}

module.exports = services
