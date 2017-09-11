global.Promise = require('bluebird')

const debug = require('debug')('tradle:sls:env')
const clone = require('xtend')
const extend = require('xtend/mutable')
const { splitCamelCase } = require('./string-utils')

const env = clone(require('../conf/env'))
if (process.env.NODE_ENV === 'test') {
  extend(process.env, require('../test/service-map'))
}

env.set = obj => {
  if (process.env !== obj) {
    extend(process.env, obj)
  }

  extend(env, obj)
}

env.set(process.env)
env.TESTING = env.NODE_ENV === 'test'

// this one might be set dynamically
// env.__defineGetter__('IOT_ENDPOINT', () => process.env.IOT_ENDPOINT)

const {
  SERVERLESS_STAGE,
  SERVERLESS_SERVICE
} = env

env.RESOURCES_ENV_PATH = `/tmp/serverless/${SERVERLESS_SERVICE}/env.${SERVERLESS_STAGE}.json`

// if (!env.SERVERLESS_DEPLOYMENT_BUCKET) {
//   env.SERVERLESS_DEPLOYMENT_BUCKET = `io.tradle.${env.SERVERLESS_STAGE}.deploys`
// }

env.BLOCKCHAIN = (function () {
  const { BLOCKCHAIN='bitcoin:testnet' } = env
  const [flavor, networkName] = BLOCKCHAIN.split(':')
  return {
    flavor,
    networkName,
    toString: () => BLOCKCHAIN,
    select: obj => obj[flavor]
  }
}())

env.DEV = !(env.SERVERLESS_STAGE || '').startsWith('prod')
env.IS_LAMBDA_ENVIRONMENT = !!process.env.AWS_REGION

module.exports = env
