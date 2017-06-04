const debug = require('debug')('tradle:sls:λ:preauth')
const { sts, getIotEndpoint } = require('../aws')
const wrap = require('../wrap')
const { IotClientRole } = require('../env')
const { getTemporaryIdentity } = require('../auth')
const { LambdaInvalidInvocation } = require('../errors')
const { randomString } = require('../utils')

exports.handler = wrap.generator(function* (event, context) {
  const { queryStringParameters, requestContext } = event
  const { clientId, tip } = queryStringParameters
  const { accountId } = requestContext
  const identity = yield getTemporaryIdentity({ accountId, clientId, tip })
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(identity)
  }
})
