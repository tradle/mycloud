// const clone = require('xtend')
// const debug = require('debug')('tradle:sls:lambda-utils')
const aws = require('./aws')
const { SERVERLESS_PREFIX } = require('./env')
// const topicToLamba = require('./lambda-by-topic')
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

// exports.invokeForTopic = function invokeForTopic (topic, items) {
//   if (!SERVERLESS_PREFIX) {
//     throw new Error('this function requires the "SERVERLESS_PREFIX" environment variable')
//   }

//   if (!(topic in topicToLamba)) {
//     debug(`ignoring event with topic "${topic}", corresponding lambda not found`)
//     return RESOLVED
//   }

//   // hmm, should we invoke with RequestResponse?
//   // those other lambdas better be fast
//   const params = clone(
//     invokeDefaults,
//     topicToLamba[topic],
//     {
//       arg: JSON.stringify(items)
//     }
//   )

//   if (!params.sync) {
//     params.log = false
//   }

//   return utils.invoke(params)
// }

