const crypto = require('crypto')
const debug = require('debug')('tradle:sls:auth')
const { utils } = require('@tradle/engine')
const aws = require('./aws')
const Iot = require('./iot-utils')
const { IOT_CLIENT_ROLE } = require('./env')
const { co, randomString, cachifyPromiser, prettify, typeforce } = require('./utils')
const { HandshakeFailed, InvalidInput, NotFound } = require('./errors')
const { HANDSHAKE_TIMEOUT, PERMALINK } = require('./constants')
const Objects = require('./objects')
const Messages = require('./messages')
const Identities = require('./identities')
const types = require('./types')
const { PresenceTable } = require('./tables')

// const onExit = co(function* ({ clientId }) {
//   try {
//     yield PresenceTable.del({
//       KeyConditionExpression: '#clientId = :clientId',
//       ExpressionAttributeNames: {
//         '#clientId': 'clientId'
//       },
//       ExpressionAttributeValues: {
//         ':clientId': clientId
//       }
//     })
//   } catch (err) {
//     debug(`Failed to delete clientId => permalink mapping in ${PresenceTable}`, err)
//   }
// })

// const onEnter = co(function* ({ clientId }) {
//   return publish({
//     topic: `${clientId}/handshake`,
//     payload: randomString(20),
//     qos: 1
//   })
// })

const onAuthenticated = co(function* ({ clientId, permalink, clientPosition, serverPosition }) {
  // TODO: change to use `update`
  const session = {
    clientId,
    permalink,
    clientPosition,
    serverPosition,
    authenticated: true,
    time: Date.now()
  }

  debug('saving session', prettify(session))

  // yield deleteSessionsByPermalink(permalink)
  yield PresenceTable.put(session)

  // yield Iot.sendAuthenticated({ clientId })
})

function deleteSessionsByPermalink (permalink) {
  return PresenceTable.del({
    KeyConditionExpression: 'permalink = :permalink AND begins_with(clientId, :permalink)',
    ExpressionAttributeValues: {
      ':permalink': permalink
    }
  })
}

function getSessionsByPermalink (permalink) {
  return PresenceTable.find({
    // ConditionExpression: '#permalink = :permalink AND #authenticated = :authenticated',
    KeyConditionExpression: 'permalink = :permalink AND begins_with(clientId, :permalink)',
    ExpressionAttributeValues: {
      ':permalink': permalink,
      // ':authenticated': true
    }
  })
}

const getMostRecentSessionByPermalink = co(function* (permalink) {
  const sessions = yield getSessionsByPermalink(permalink)
  const latest = sessions
    .filter(session => session.authenticated)
    .sort((a, b) => {
      return a.time - b.time
    })
    .pop()

  if (!latest) {
    throw new NotFound('no authenticated sessions found')
  }

  debug('latest authenticated session:', prettify(latest))
  return latest
})

function getSession ({ clientId }) {
  return PresenceTable.findOne({
    KeyConditionExpression: 'permalink = :permalink AND clientId = :clientId',
    ExpressionAttributeValues: {
      ':clientId': clientId,
      ':permalink': getPermalinkFromClientId(clientId),
      // ':authenticated': true
    }
  })
}

const createChallenge = co(function* ({ clientId, permalink, endpointAddress }) {
  // const permalink = getPermalinkFromClientId(clientId)
  const challenge = newNonce()
  yield PresenceTable.put({
    clientId,
    permalink,
    challenge,
    authenticated: false
  })

  return challenge
})

// const sendChallenge = co(function* ({ clientId, permalink }) {
//   const challenge = yield createChallenge({ clientId, permalink })
//   yield Iot.sendChallenge({ clientId, challenge })
// })

const handleChallengeResponse = co(function* (response) {
  try {
    typeforce({
      clientId: typeforce.String,
      permalink: typeforce.String,
      challenge: typeforce.String,
      position: types.position
    }, response)
  } catch (err) {
    debug('received invalid input', err.stack)
    throw new InvalidInput(err.message)
  }

  const { clientId, permalink, challenge, position } = response

  // const permalink = getPermalinkFromClientId(clientId)
  const stored = yield PresenceTable.get({ clientId, permalink })
  if (challenge !== stored.challenge) {
    throw new HandshakeFailed('stored challenge does not match response')
  }

  if (permalink !== stored.permalink) {
    throw new HandshakeFailed('claimed permalink changed from preauth')
  }

  if (Date.now() - stored.time > HANDSHAKE_TIMEOUT) {
    throw new HandshakeFailed('handshake timed out')
  }

  // validate sig
  const metadata = Objects.addMetadata({ object: response })
  yield Identities.addAuthorMetadata(metadata)

  console.log(`claimed: ${permalink}, actual: ${metadata.author}`)
  if (metadata.author !== permalink) {
    throw new HandshakeFailed('signature does not match claimed identity')
  }

  const session = { permalink, clientId, clientPosition: position }
  const getLastSent = Messages.getLastMessageTo({ recipient: permalink, body: false })
    .then(msg => Messages.getMessageId)
    .catch(err => {
      if (err instanceof NotFound) return null

      throw err
    })

  session.serverPosition = {
    sent: yield getLastSent
  }

  yield onAuthenticated(session)
  return session
})

const getTemporaryIdentity = co(function* (opts) {
  try {
    typeforce({
      accountId: typeforce.String,
      clientId: typeforce.String,
      identity: types.identity
    }, opts)
  } catch (err) {
    debug('received invalid input', err.stack)
    throw new InvalidInput(err.message)
  }

  const { accountId, clientId, identity } = opts
  const permalink = identity[PERMALINK] || utils.hexLink(identity)
  if (permalink !== getPermalinkFromClientId(clientId)) {
    throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}')
  }

  const maybeAddContact = Identities.validateNewContact({ object: identity })
    .then(result => {
      if (!result.exists) return Identities.addContact(result)
    })

  const role = `arn:aws:iam::${accountId}:role/${IOT_CLIENT_ROLE}`
  debug(`generating temp keys for client ${clientId}, role ${role}`)

  // get the account id which will be used to assume a role

  const { endpointAddress } = yield aws.getIotEndpoint()
  debug('assuming role', role)
  const region = Iot.getRegionFromEndpoint(endpointAddress)
  const params = {
    RoleArn: role,
    RoleSessionName: randomString(16),
  }

  // assume role returns temporary keys
  const [challenge, addContact] = yield [
    createChallenge({ clientId, permalink, endpointAddress }),
    maybeAddContact
  ]

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

function getMostRecentSessionByClientId (clientId) {
  return getMostRecentSessionByPermalink(getPermalinkFromClientId(clientId))
}

// const isMostRecentSession = co(function* ({ clientId }) {
//   try {
//     const session = yield getMostRecentSessionByPermalink(getPermalinkFromClientId(clientId))
//     return session.clientId === clientId
//   } catch (err) {}
// })


function newNonce () {
  return crypto.randomBytes(32).toString('hex')
}

function getPermalinkFromClientId (clientId) {
  return clientId.slice(0, 64)
}

module.exports = {
  // onEnter,
  // onExit,
  createChallenge,
  // sendChallenge,
  handleChallengeResponse,
  getTemporaryIdentity,
  getSession,
  getSessionsByPermalink,
  getMostRecentSessionByPermalink,
  getMostRecentSessionByClientId,
  // isMostRecentSession
}
