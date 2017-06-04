const crypto = require('crypto')
const debug = require('debug')('tradle:sls:auth')
const aws = require('./aws')
const { iot, sts, getIotEndpoint } = aws
const Iot = require('./iot-utils')
// const { iotData } = require('./aws')
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

const onAuthenticated = co(function* ({ clientId, permalink }) {
  // TODO: change to use `update`
  yield put({
    TableName: PresenceTable,
    Key: { clientId },
    Item: {
      clientId,
      authenticated: true
    }
  })

  yield Iot.sendAuthenticated({ clientId })
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

const isAuthenticated = co(function* ({ clientId, permalink }) {
  let presence
  try {
    presence = yield get({
      TableName: PresenceTable,
      Key: { clientId }
    })
  } catch (err) {
    return false
  }

  return presence.authenticated
})

const createChallenge = co(function* ({ clientId, endpointAddress, tip }) {
  const permalink = getPermalinkFromClientId(clientId)
  const challenge = newNonce()
  yield put({
    TableName: PresenceTable,
    Key: { clientId },
    Item: {
      clientId,
      challenge,
      authenticated: false,
      time: Date.now(),
      tip
    }
  })

  return challenge
})

const sendChallenge = co(function* ({ clientId }) {
  const challenge = yield createChallenge({ clientId })
  yield Iot.sendChallenge({ clientId, challenge })
})

const handleChallengeResponse = co(function* ({ clientId, response }) {
  const permalink = getPermalinkFromClientId(clientId)
  const { challenge, tip, time } = yield get({
    TableName: PresenceTable,
    Key: { clientId }
  })

  if (response.challenge !== challenge) {
    throw new HandshakeFailed('stored challenge does not match response')
  }

  if (Date.now() - time > HANDSHAKE_TIMEOUT) {
    throw new HandshakeFailed('handshake timed out')
  }

  // validate sig
  const metadata = yield Objects.extractMetadata(response)
  if (metadata.author !== permalink) {
    throw new HandshakeFailed('signature does not match claimed identity')
  }

  yield onAuthenticated({ permalink, clientId })
  return {
    tip,
    clientId,
    permalink
  }

  // const tip = yield Messages.getLastSent({ recipient: permalink })
  // yield publish({
  //   topic: `${clientId}/tip`,
  //   payload: { tip },
  //   qos: 1
  // })
})

const getTemporaryIdentity = co(function* ({ accountId, clientId, tip }) {
  if (!clientId) {
    throw new LambdaInvalidInvocation('expected "clientId"')
  }

  const role = `arn:aws:iam::${accountId}:role/${IotClientRole}`
  debug(`generating temp keys for client ${clientId}, role ${role}`)

  // get the account id which will be used to assume a role

  const { endpointAddress } = yield getIotEndpoint()
  debug('assuming role', role)
  const region = Iot.getRegionFromEndpoint(endpointAddress)
  const params = {
    RoleArn: role,// `arn:aws:iam:${region}:${accountId}:role/${IotClientRole}`,
    RoleSessionName: randomString(16),
  }

  // assume role returns temporary keys
  const challenge = yield createChallenge({ clientId, tip, endpointAddress })
  const { Credentials } = yield sts.assumeRole(params).promise()
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

function getPermalinkFromClientId (clientId) {
  return {
    permalink: clientId.slice(64)
  }
}

module.exports = {
  // onEnter,
  onExit,
  createChallenge,
  sendChallenge,
  getTemporaryIdentity
}
