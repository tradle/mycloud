const { iot, sts } = require('../aws')
const wrap = require('../wrap')
const { IotRoleName } = require('../env')
const { createChallenge } = require('../presence')
const { LambdaInvalidInvocation } = require('../errors')

exports.handler = wrap.generator(function* (event, context) {
  const { clientId } = event
  if (!clientId) {
    throw new LambdaInvalidInvocation('expected "clientId"')
  }

  const promiseChallenge = createChallenge({ clientId })

  // get the endpoint address
  const promiseEndpoint = iot.describeEndpoint().promise()

  // get the account id which will be used to assume a role
  const promiseCaller = sts.getCallerIdentity().promise()

  const [endpoint, caller] = yield [promiseEndpoint, promiseCaller]
  const { endpointAddress } = endpoint
  const region = getRegion(endpointAddress)
  const params = {
    RoleArn: `arn:aws:iam::${caller.Account}:role/${IotRoleName}`,
    RoleSessionName: getRandomInt().toString()
  }

  // assume role returns temporary keys
  const { Credentials } = yield sts.assumeRole(params)
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      iotEndpoint: endpointAddress,
      region,
      accessKey: Credentials.AccessKeyId,
      secretKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
      challend: yield promiseChallenge
    })
  }
})

function getRegion (iotEndpoint) {
  const partial = iotEndpoint.replace('.amazonaws.com', '');
  const iotIndex = iotEndpoint.indexOf('iot');
  return partial.substring(iotIndex + 4);
}

// Get random Int
function getRandomInt () {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
}
