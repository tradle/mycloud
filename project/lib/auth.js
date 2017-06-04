const crypto = require('crypto')
const debug = require('debug')('tradle:sls:auth')
const aws = require('./aws')
const Iot = require('./iot-utils')
const { get, put, del, findOne } = require('./db-utils')
const { PresenceTable, IotClientRole } = require('./env')
const { co, randomString, cachifyPromiser } = require('./utils')
const { HandshakeFailed, LambdaInvalidInvocation } = require('./errors')
const { HANDSHAKE_TIMEOUT } = require('./constants')
const Objects = require('./objects')
const Messages = require('./messages')

const onExit = co(function* ({ clientId }) {
  try {
    yield del({
      TableName: PresenceTable,
      KeyConditionExpression: '#clientId = :clientId',
      ExpressionAttributeNames: {
        '#clientId': 'clientId'
      },
      ExpressionAttributeValues: {
        ':clientId': clientId
      }
    })
  } catch (err) {
    debug(`Failed to delete clientId => permalink mapping in ${PresenceTable}`, err)
  }
})

// const onEnter = co(function* ({ clientId }) {
//   return publish({
//     topic: `${clientId}/handshake`,
//     payload: randomString(20),
//     qos: 1
//   })
// })

const onAuthenticated = co(function* ({ clientId, permalink, tip }) {
  // TODO: change to use `update`
  yield put({
    TableName: PresenceTable,
    Key: { clientId },
    Item: {
      clientId,
      permalink,
      tip,
      authenticated: true
    }
  })

  // yield Iot.sendAuthenticated({ clientId })
})

const getAuthenticatedClient = co(function* ({ permalink }) {
  const result = yield findOne({
    TableName: PresenceTable,
    ConditionExpression: '#permalink = :permalink AND #authenticated = :authenticated',
    ExpressionAttributeNames: {
      '#permalink': 'permalink',
      '#authenticated': 'authenticated'
    },
    ExpressionAttributeValues: {
      ':permalink': permalink,
      ':authenticated': true
    }
  })

  return result.clientId
})

const getSession = co(function* ({ clientId }) {
  return get({
    TableName: PresenceTable,
    Key: { clientId }
  })
})

const createChallenge = co(function* ({ clientId, permalink, endpointAddress }) {
  // const permalink = getPermalinkFromClientId(clientId)
  const challenge = newNonce()
  yield put({
    TableName: PresenceTable,
    Key: { clientId },
    Item: {
      clientId,
      permalink,
      challenge,
      authenticated: false,
      time: Date.now()
    }
  })

  return challenge
})

// const sendChallenge = co(function* ({ clientId, permalink }) {
//   const challenge = yield createChallenge({ clientId, permalink })
//   yield Iot.sendChallenge({ clientId, challenge })
// })

const handleChallengeResponse = co(function* (response) {
  const { clientId, permalink, challenge, tip } = response
  // const permalink = getPermalinkFromClientId(clientId)
  const stored = yield get({
    TableName: PresenceTable,
    Key: { clientId }
  })

  if (response.challenge !== stored.challenge) {
    throw new HandshakeFailed('stored challenge does not match response')
  }

  if (permalink !== stored.permalink) {
    throw new HandshakeFailed('claimed permalink changed from preauth')
  }

  if (Date.now() - stored.time > HANDSHAKE_TIMEOUT) {
    throw new HandshakeFailed('handshake timed out')
  }

  // validate sig
  const metadata = yield Objects.extractMetadata(response)
  console.log(`claimed: ${permalink}, actual: ${metadata.author}`)
  if (metadata.author !== permalink) {
    throw new HandshakeFailed('signature does not match claimed identity')
  }

  const session = { permalink, clientId, tip }
  yield onAuthenticated(session)
  return session

  // const tip = yield Messages.getLastSent({ recipient: permalink })
  // yield publish({
  //   topic: `${clientId}/tip`,
  //   payload: { tip },
  //   qos: 1
  // })
})

const getTemporaryIdentity = co(function* ({ accountId, clientId, permalink }) {
  if (!clientId) {
    throw new LambdaInvalidInvocation('expected "clientId"')
  }

  const role = `arn:aws:iam::${accountId}:role/${IotClientRole}`
  debug(`generating temp keys for client ${clientId}, role ${role}`)

  // get the account id which will be used to assume a role

  const { endpointAddress } = yield aws.getIotEndpoint()
  debug('assuming role', role)
  const region = Iot.getRegionFromEndpoint(endpointAddress)
  const params = {
    RoleArn: role,// `arn:aws:iam:${region}:${accountId}:role/${IotClientRole}`,
    RoleSessionName: randomString(16),
  }

  // assume role returns temporary keys
  const challenge = yield createChallenge({ clientId, permalink, endpointAddress })
  const { Credentials } = yield aws.sts.assumeRole(params).promise()
  return {
    iotEndpoint: endpointAddress,
    region: region,
    accessKey: Credentials.AccessKeyId,
    secretKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
    challenge
  }
})

function newNonce () {
  return crypto.randomBytes(32).toString('hex')
}

// function getPermalinkFromClientId (clientId) {
//   return clientId.slice(0, 64)
// }

module.exports = {
  // onEnter,
  onExit,
  createChallenge,
  // sendChallenge,
  handleChallengeResponse,
  getTemporaryIdentity,
  getSession
}
