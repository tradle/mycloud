
global.Promise = require('bluebird')

if (process.env.NODE_ENV === 'test') {
  require('../test/env')
} else {
  require('source-map-support').install()
}

process.on('unhandledRejection', function (reason, promise) {
  debug('possibly unhandled rejection', reason)
})

const debug = require('debug')('tradle:sls:env')

const mockery = require('mockery')
mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
})

mockery.registerMock('scrypt', {})
debug('mocking "scrypt" as it is an unneeded dep (here) of ethereumjs-wallet')

const clone = require('xtend')
const extend = require('xtend/mutable')
const { splitCamelCase } = require('./string-utils')
const networks = require('./networks')
const constants = require('./constants')

const env = {}
env.IS_LAMBDA_ENVIRONMENT = !!process.env.AWS_REGION
if (process.env.NODE_ENV === 'test') {
  extend(process.env, require('../test/service-map'))
} else if (!env.IS_LAMBDA_ENVIRONMENT) {
  require('./cli/utils').loadCredentials()
  try {
    extend(process.env, require('../test/fixtures/remote-service-map'))
  } catch (err) {}
}

env.set = obj => {
  if (process.env !== obj) {
    extend(process.env, obj)
  }

  extend(env, obj)
}

env.setFromLambdaEvent = (event, context) => {
  const { parseArn } = require('./utils')
  const { invokedFunctionArn } = context
  if (invokedFunctionArn) {
    const {
      accountId
    } = parseArn(invokedFunctionArn)

    env.set({ accountId })
  }
}

env.set(process.env)
env.REGION = env.AWS_REGION
env.TESTING = env.NODE_ENV === 'test'
// env.prefix = env.SERVERLESS_PREFIX

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
  const { BLOCKCHAIN='ethereum:ropsten' } = env
  const [flavor, networkName] = BLOCKCHAIN.split(':')
  return networks[flavor][networkName]
}())

env.DEV = !(env.SERVERLESS_STAGE || '').startsWith('prod')

module.exports = env
