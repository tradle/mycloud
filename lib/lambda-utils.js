const debug = require('debug')('tradls:sls:lambda-utils')
const co = require('co').wrap
const aws = require('./aws')

module.exports = Utils

function Utils ({ env }) {
  const {
    SERVERLESS_SERVICE,
    SERVERLESS_STAGE
  } = env

  function getFullName (name) {
    const { SERVERLESS_PREFIX='' } = require('./env')
    return name.startsWith(SERVERLESS_PREFIX)
      ? name
      : `${SERVERLESS_PREFIX}${name}`
  }

  const invoke = co(function* ({ name, arg={}, sync=true, log }) {
    const FunctionName = getFullName(name)
    const params = {
      InvocationType: sync ? 'RequestResponse' : 'Event',
      FunctionName,
      Payload: typeof arg === 'string' ? arg : JSON.stringify(arg)
    }

    if (log) params.LogType = 'Tail'

    const {
      StatusCode,
      Payload,
      FunctionError
    } = yield aws.lambda.invoke(params).promise()

    if (StatusCode >= 300) {
      const message = Payload || `experienced ${FunctionError} error invoking lambda: ${name}`
      throw new Error(message)
    }

    if (sync) return JSON.parse(Payload)
  })

  function getConfiguration (FunctionName) {
    debug(`looking up configuration for ${FunctionName}`)
    return aws.lambda.getFunctionConfiguration({ FunctionName }).promise()
  }

  function getStack (StackName) {
    return aws.cloudformation.listStackResources({ StackName }).promise()
  }

  return {
    getFullName,
    invoke,
    getStack,
    getConfiguration
  }
}
