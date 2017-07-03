const debug = require('debug')('tradls:sls:lambda-utils')
const co = require('co').wrap
const aws = require('./aws')
const {
  SERVERLESS_SERVICE,
  SERVERLESS_STAGE
} = require('./env')

const invokeDefaults = {}
const utils = exports

function getFullName (name) {
  const { SERVERLESS_PREFIX } = require('./env')
  return `${SERVERLESS_PREFIX}${name}`
}

function invoke ({ name, arg, sync=true, log }) {
  const params = {
    InvocationType: sync ? 'RequestResponse' : 'Event',
    FunctionName: getFullName(name),
    Payload: typeof arg === 'string' ? arg : JSON.stringify(arg)
  }

  if (log) params.LogType = 'Tail'

  return aws.lambda.invoke(params).promise()
}

module.exports = {
  getFullName,
  invoke
}
