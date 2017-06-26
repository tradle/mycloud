const aws = require('./aws')
const { SERVERLESS_PREFIX } = require('./env')
const invokeDefaults = {}

const RESOLVED = Promise.resolve()
const utils = exports

module.exports = {
  getFullName,
  invoke
}

function getFullName (name) {
  return `${SERVERLESS_PREFIX}${name}`
}

function invoke ({ name, arg, sync=true, log }) {
  const params = {
    InvocationType: sync ? 'RequestResponse' : 'Event',
    FunctionName: getFullName(name),
    Payload: JSON.stringify(arg)
  }

  if (log) params.LogType = 'Tail'

  return aws.lambda.invoke(params).promise()
}
