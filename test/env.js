// console.warn('make sure localstack is running (npm run localstack:start)')

process.env.NODE_ENV = 'test'
process.env.IS_LOCAL = true

require('source-map-support').install()

const debug = require('debug')('tradle:sls:test:env')
const serviceMap = require('./service-map')
const pick = require('object.pick')
const extend = require('xtend/mutable')
const AWS = require('aws-sdk-mock')
AWS.mock('STS', 'assumeRole', function (params, callback) {
  debug('assumed role')
  callback(null, {
    AssumedRoleUser: {
      AssumedRoleId: 'abcdef'
    },
    Credentials: {
      AccessKeyId: 'abc',
      SecretAccessKey: 'def',
      SessionToken: 'ghi'
    }
  })
})

extend(process.env, pick(serviceMap, [
  'SERVERLESS_STAGE',
  'SERVERLESS_SERVICE_NAME',
  'SERVERLESS_PREFIX'
]))
