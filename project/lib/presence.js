const crypto = require('crypto')
const { iotData } = require('./aws')
const { get, put, del } = require('./db-utils')
const { PresenceTable } = require('./env')
const { co, randomString } = require('./utils')
const { HandshakeFailed } = require('./errors')
const { HANDSHAKE_TIMEOUT } = require('./constants')
const Objects = require('./objects')
const Messages = require('./messages')

const onExit = co(function* ({ clientId }) {
  try {
    yield del({
      TableName: PresenceTable,
      ConditionExpression: '#clientId = :cliendId',
      ExpressionAttributeNames: {
        '#clientId': 'clientId'
      },
      ExpressionAttributeValues: {
        ':clientId': clientId
      }
    })
  } catch (err) {
    console.log(`Failed to delete clientId => permalink mapping in ${PresenceTable}`, err)
  }
})

const onEnter = co(function* ({ clientId }) {
  return publish({
    topic: `${clientId}/handshake`,
    payload: randomString(20),
    qos: 1
  })
})

function onAuthenticated ({ clientId, permalink }) {
  return put({
    TableName: PresenceTable,
    Key: { clientId },
    Item: {
      clientId,
      authenticated: true
    }
  })
}

const createChallenge = co(function* ({ clientId }) {
  const permalink = getPermalinkFromClientId(clientId)
  const challenge = newNonce()
  yield put({
    TableName: PresenceTable,
    Key: { clientId },
    Item: {
      clientId,
      challenge,
      authenticated: false,
      time: Date.now()
    }
  })
})

const sendChallenge = co(function* ({ clientId }) {
  const challenge = yield createChallenge({ clientId })
  yield publish({
    topic: `${clientId}/challenge`,
    payload: { challenge },
    qos: 1
  })
})

const handleChallengeResponse = co(function* ({ clientId, response }) {
  const permalink = getPermalinkFromClientId(clientId)
  const storedChallenge = yield get({
    TableName: PresenceTable,
    Key: { clientId }
  })

  if (response.challenge !== storedChallenge.challenge) {
    throw new HandshakeFailed('stored challenge does not match response')
  }

  if (Date.now() - storedChallenge.time > HANDSHAKE_TIMEOUT) {
    throw new HandshakeFailed('handshake timed out')
  }

  // validate sig
  const metadata = yield Objects.extractMetadata(response)
  if (metadata.author !== permalink) {
    throw new HandshakeFailed('signature does not match claimed identity')
  }

  yield onAuthenticated({ permalink, clientId })

  const tip = yield Messages.getLastSent({ recipient: permalink })
  yield publish({
    topic: `${clientId}/tip`,
    payload: { tip },
    qos: 1
  })
})

function newNonce () {
  return crypto.randomBytes(32).toString('hex')
}

function publish (params) {
  return iotData.publish(params).promise()
}

function getPermalinkFromClientId (clientId) {
  return {
    permalink: clientId.slice(64)
  }
}

module.exports = {
  onEnter,
  onExit,
  createChallenge,
  sendChallenge
}
