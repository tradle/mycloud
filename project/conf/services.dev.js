const localstack = require('./localstack')
const services = {
  "maxRetries": 6,
  "region": "us-east-1"
}

for (let name in localstack) {
  let lname = name.toLowerCase()
  if (!services[lname]) services[lname] = {}

  services[lname].endpoint = localstack[name]
}

services.s3.s3ForcePathStyle = true

module.exports = services
