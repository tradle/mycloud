const { clone, pick, splitCamelCase } = require('./utils')
const env = clone(
  require('../../env'),
  pick(process.env, [
    'NETWORK_NAME',
    'SERVERLESS_SERVICE_NAME',
    'SERVERLESS_STAGE',
    'SERVERLESS_PREFIX',
    'PUSH_SERVER_URL'
  ])
)

for (let prop in process.env) {
  if (prop.slice(0, 3) === 'CF_') {
    let split = splitCamelCase(prop.slice(3), '_').toUpperCase()
    env[split] = process.env[prop]
  }
}

module.exports = env
