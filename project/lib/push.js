
const crypto = require('crypto')
const superagent = require('superagent')
const subdown = require('subleveldown')
const { protocol, signBuffer } = require('@tradle/engine')
const { cachifyPromiser, sha256, executeSuperagentRequest } = require('./utils')
// const constants = require('@tradle/engine').constants
// const TYPE = constants.TYPE

const ENV = require('./env')
const { PrivateConfBucket } = require('./buckets')
const { PushSubscribers } = require('./tables')
const { PUSH_SERVER_URL } = require('./env')

  // const serverUrl = opts.url
  // const key = opts.key
  // const identity = opts.identity
  // const publisher = protocol.linkString(identity)

const ensureRegistered = cachifyPromiser(co(function* (key) {
  const registered = yield isRegistered()
  if (!registered) yield register(key)
}))

function isRegistered (serverUrl) {
  return ConfStateBucket.exists(serverUrl)
}

function setRegistered (serverUrl) {
  return ConfStateBucket.putJSON(serverUrl, {
    dateRegistered: Date.now()
  })
}

const register = co(function* ({ key }) {
  const req = superagent
    .post(`${serverUrl}/publisher`)
    .send({
      identity: identity,
      key: key.toJSON()
    })

  yield executeSuperagentRequest(req)
  // if (!res.ok) throw new Error('push publisher registration failed')

  // challenge
  const nonce = res.text
  const salt = crypto.randomBytes(32).toString('base64')
  const sig = signBuffer(key, sha256(nonce + salt))
  const req = superagent
    .post(`${serverUrl}/publisher`)
    .send({ nonce, salt, sig })

  yield executeSuperagentRequest(req)
  yield setRegistered(serverUrl)
})

const push = co(function* ({ key, subscriber }) {
  yield ensureRegistered(key)
  let info
  try {
    info = yield PushSubscribers.update({
      Key: { subscriber },
      UpdateExpression: 'SET seq = seq + :incr',
      ExpressionAttributeValues: {
        ':incr': 1
      }
    })
  } catch (err) {
    info = { seq: -1 }
  }

  yield PushSubscribers.update({
    Key: { subscriber },
    Item: info
  })

  const nonce = crypto.randomBytes(8).toString('base64')
  const sig = signBuffer(key, sha256(seq + nonce))
  const body = { publisher, subscriber, seq, nonce, sig }
  const req = superagent.post(`${serverUrl}/notification`).send(body)
  yield executeSuperagentRequest(req)
})
