// console.warn('make sure localstack is running (npm run localstack:start)')

process.env.NODE_ENV = 'test'
process.env.IS_LOCAL = true

const pick = require('object.pick')
const extend = require('xtend/mutable')
const serviceMap = require('../conf/service-map')
extend(process.env, pick(serviceMap, ['SERVERLESS_STAGE', 'SERVERLESS_SERVICE']))
