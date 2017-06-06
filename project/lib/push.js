
const crypto = require('crypto')
const superagent = require('superagent')
const subdown = require('subleveldown')
const { protocol } = require('@tradle/engine')
const { cachifyPromiser } = require('./utils')
// const constants = require('@tradle/engine').constants
// const TYPE = constants.TYPE

const ENV = require('./env')
const { ConfStateBucket } = require('./buckets')
const { PUSH_SERVER_URL } = require('./constants')

  // const serverUrl = opts.url
  // const key = opts.key
  // const identity = opts.identity
  // const publisher = protocol.linkString(identity)

const maybeRegister = cachifyPromiser(co(function* (key) {
  const registered = yield isRegistered()
  if (!registered) yield register(key)
}))

function isRegistered (serverUrl) {
  return ConfStateBucket.exists(serverUrl)
}

const setRegistered = co(function* (serverUrl) {
  return ConfStateBucket.putJSON(serverUrl, {})
})

const register = co(function* (key) {
  const res = yield superagent
    .post(`${serverUrl}/publisher`)
    .send({
      identity: identity,
      key: key.toJSON()
    })

  if (!res.ok) throw new Error('push publisher registration failed')

  // challenge
  const nonce = res.text
  const salt = crypto.randomBytes(32).toString('base64')
  const sig = signBuffer(key, sha256(nonce + salt))
  const req = superagent
    .post(`${serverUrl}/publisher`)
    .send({ nonce, salt, sig })

  yield executeRequest(req)
})

const push = co(function* ({ key, subscriber }) {
  yield maybeRegister(key)
  let info
  try {
    info = yield get({
      TableName: PushSubscribers,
      Key: subscriber
    })
  } catch (err) {
    info = { seq: -1 }
  }

  const seq = ++info.seq
  yield put({
    TableName: PushSubscribers,
    Key: subscriber,
    Item: info
  })

  const nonce = crypto.randomBytes(8).toString('base64')
  const sig = signBuffer(key, sha256(seq + nonce))
  const body = { publisher, subscriber, seq, nonce, sig }
  const req = superagent.post(`${serverUrl}/notification`).send(body)
  yield executeRequest(req)
  yield setRegistered(serverUrl)
})

function executeRequest (req) {
  return req.then(res => {
    if (!res.ok) {
      throw new Error(res.text || `request to ${req.url} failed`)
    }
  })
}

function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest('base64')
}
