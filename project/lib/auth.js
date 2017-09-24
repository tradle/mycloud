const debug = require('debug')('tradle:sls:auth')
const { getUpdateParams } = require('./db-utils')
const { co, cachifyPromiser, typeforce, bindAll } = require('./utils')
const { prettify } = require('./string-utils')
const { randomString, getPermalink } = require('./crypto')
const { HandshakeFailed, InvalidInput, NotFound } = require('./errors')
const types = require('./types')
const { constants } = require('./')
const { HANDSHAKE_TIMEOUT, PERMALINK } = constants

// const onExit = co(function* ({ clientId }) {
//   try {
//     yield this.tables.Presence.del({
//       KeyConditionExpression: '#clientId = :clientId',
//       ExpressionAttributeNames: {
//         '#clientId': 'clientId'
//       },
//       ExpressionAttributeValues: {
//         ':clientId': clientId
//       }
//     })
//   } catch (err) {
//     debug(`Failed to delete clientId => permalink mapping in ${Presence}`, err)
//   }
// })

// const onEnter = co(function* ({ clientId }) {
//   return publish({
//     topic: `${clientId}/handshake`,
//     payload: randomString(20),
//     qos: 1
//   })
// })

module.exports = Auth

function Auth ({ env, aws, resources, tables, identities, objects, messages }) {
  bindAll(this)

  this.env = env
  this.aws = aws
  this.resources = resources
  this.tables = tables
  this.identities = identities
  this.objects = objects
  this.messages = messages
}

const proto = Auth.prototype

proto.onAuthenticated = co(function* ({ clientId, permalink, clientPosition, serverPosition }) {
  // TODO: change to use `update`
  const session = {
    clientId,
    permalink,
    clientPosition,
    serverPosition,
    authenticated: true,
    time: Date.now(),
    connected: false
  }

  debug('saving session', prettify(session))

  // allow multiple sessions for the same user?
  // yield deleteSessionsByPermalink(permalink)
  yield this.tables.Presence.put({ Item: session })
})

proto.updatePresence = function updatePresence ({ clientId, connected }) {
  const params = getUpdateParams({ connected })
  params.Key = getKeyFromClientId(clientId)
  return this.tables.Presence.update(params)
}

proto.deleteSession = function deleteSession (clientId) {
  const Key = getKeyFromClientId(clientId)
  return this.tables.Presence.del({ Key })
}

proto.deleteSessionsByPermalink = function deleteSessionsByPermalink (permalink) {
  return this.tables.Presence.del(getSessionsByPermalinkQuery)
}

proto.getSessionsByPermalink = function getSessionsByPermalink (permalink) {
  return this.tables.Presence.find(getSessionsByPermalinkQuery(permalink))
}

proto.getLiveSessionByPermalink = co(function* (permalink) {
  const sessions = yield this.getSessionsByPermalink(permalink)
  const latest = sessions
    .filter(session => session.authenticated && session.connected)
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

proto.getSession = function getSession ({ clientId }) {
  return this.tables.Presence.findOne({
    KeyConditionExpression: 'permalink = :permalink AND clientId = :clientId',
    ExpressionAttributeValues: {
      ':clientId': clientId,
      ':permalink': getPermalinkFromClientId(clientId),
      // ':authenticated': true
    }
  })
}

proto.createChallenge = co(function* ({ clientId, permalink }) {
  // const permalink = getPermalinkFromClientId(clientId)
  const challenge = randomString(32)
  yield this.tables.Presence.put({
    Item: {
      clientId,
      permalink,
      challenge,
      authenticated: false
    }
  })

  return challenge
})

// const sendChallenge = co(function* ({ clientId, permalink }) {
//   const challenge = yield createChallenge({ clientId, permalink })
//   yield Iot.sendChallenge({ clientId, challenge })
// })

proto.handleChallengeResponse = co(function* (response) {
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
  const stored = yield this.tables.Presence.get({
    Key: { clientId, permalink }
  })

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
  this.objects.addMetadata(response)
  yield this.identities.addAuthorInfo(response)

  // console.log(`claimed: ${permalink}, actual: ${response._author}`)
  if (response._author !== permalink) {
    throw new HandshakeFailed('signature does not match claimed identity')
  }

  const session = { permalink, clientId, clientPosition: position }
  const getLastSent = this.messages.getLastMessageTo({ recipient: permalink, body: false })
    .then(message => this.messages.getMessageStub({ message }))
    .catch(err => {
      if (err instanceof NotFound) return null

      throw err
    })

  session.serverPosition = {
    sent: yield getLastSent
  }

  yield this.onAuthenticated(session)
  return session
})

proto.getTemporaryIdentity = co(function* (opts) {
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
  const permalink = getPermalink(identity)
  if (permalink !== getPermalinkFromClientId(clientId)) {
    throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}')
  }

  const maybeAddContact = this.identities.validateAndAdd(identity)
  const role = `arn:aws:iam::${accountId}:role/${this.resources.Role.IotClient}`
  debug(`generating temp keys for client ${clientId}, role ${role}`)

  // get the account id which will be used to assume a role

  debug('assuming role', role)
  const params = {
    RoleArn: role,
    RoleSessionName: randomString(16),
  }

  // assume role returns temporary keys
  const [challenge, addContact] = yield [
    this.createChallenge({ clientId, permalink }),
    maybeAddContact
  ]

  const {
    AssumedRoleUser,
    Credentials
  } = yield this.aws.sts.assumeRole(params).promise()

  debug('assumed role', role)
  return {
    iotEndpoint: this.env.IOT_ENDPOINT,
    region: this.env.AWS_REGION,
    accessKey: Credentials.AccessKeyId,
    secretKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
    uploadPrefix: this.getUploadPrefix(AssumedRoleUser),
    challenge
  }
})

proto.getUploadPrefix = function getUploadPrefix (AssumedRoleUser) {
  return `${this.resources.Bucket.FileUpload}/${AssumedRoleUser.AssumedRoleId}/`
}

proto.getMostRecentSessionByClientId = function getMostRecentSessionByClientId (clientId) {
  return this.getLiveSessionByPermalink(getPermalinkFromClientId(clientId))
}

// const isMostRecentSession = co(function* ({ clientId }) {
//   try {
//     const session = yield getLiveSessionByPermalink(getPermalinkFromClientId(clientId))
//     return session.clientId === clientId
//   } catch (err) {}
// })


function getPermalinkFromClientId (clientId) {
  return clientId.slice(0, 64)
}

function getKeyFromClientId (clientId) {
  return {
    clientId,
    permalink: getPermalinkFromClientId(clientId)
  }
}

function getSessionsByPermalinkQuery (permalink) {
  return {
    KeyConditionExpression: 'permalink = :permalink AND begins_with(clientId, :permalink)',
    ExpressionAttributeValues: {
      ':permalink': permalink
    }
  }
}

// module.exports = {
//   // onEnter,
//   // onExit,
//   createChallenge,
//   // sendChallenge,
//   handleChallengeResponse,
//   getTemporaryIdentity,
//   getSession,
//   getSessionsByPermalink,
//   getLiveSessionByPermalink,
//   getMostRecentSessionByClientId,
//   deleteSession,
//   updatePresence
//   // isMostRecentSession
// }
