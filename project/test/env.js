// console.warn('make sure localstack is running (npm run localstack:start)')

process.env.NODE_ENV = 'test'
process.env.IS_LOCAL = true

const serviceMap = require('./service-map')
const pick = require('object.pick')
const extend = require('xtend/mutable')

extend(process.env, pick(serviceMap, [
  'SERVERLESS_STAGE',
  'SERVERLESS_SERVICE_NAME',
  'SERVERLESS_PREFIX'
]))
