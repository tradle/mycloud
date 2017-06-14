const fetch = global.fetch || require('node-fetch')
const util = require('util')
const { EventEmitter } = require('events')
const querystring = require('querystring')
const debug = require('debug')('tradle:aws:client')
const awsIot = require('aws-iot-device-sdk')
const bindAll = require('bindall')
const pify = require('pify')
const crypto = require('crypto')
const co = require('co').wrap
const BASE_ENDPOINT = 'https://lc2zye4lv8.execute-api.us-east-1.amazonaws.com/dev/tradle'
const PREAUTH_ENDPOINT = `${BASE_ENDPOINT}/preauth`
const AUTH_ENDPOINT = `${BASE_ENDPOINT}/auth`
const DEFAULT_ENCODING = 'utf8'

module.exports = Client

function Client (opts={}) {
  EventEmitter.call(this)
  this._authenticated = false
  this._client = null
  this._clientId = opts.clientId
  this._encoding = opts.encoding || DEFAULT_ENCODING
  this._node = null
  this._them = opts.them
  this._opts = opts
  bindAll(this)
}

util.inherits(Client, EventEmitter)

Client.prototype.setNode = function (node) {
  this._node = node
  this.auth()
}

Client.prototype.auth = loudCo(function* () {
  const node = this._node
  const { permalink, identity } = node
  const clientId = this._clientId || (this._clientId = genClientId(permalink))

  debug('fetching temporary credentials')
  const {
    iotEndpoint,
    region,
    accessKey,
    secretKey,
    sessionToken,
    challenge
  } = yield post(PREAUTH_ENDPOINT, { clientId, identity })

  // const iotEndpoint = 'a21zoo1cfp44ha.iot.us-east-1.amazonaws.com'
  // const region = 'us-east-1'
  // const accessKey = 'abc'
  // const secretKey = 'abc'
  // const sessionToken = 'abc'
  // const challenge = 'abc'

  const signed = yield node.sign({
    object: {
      _t: 'tradle.ChallengeResponse',
      clientId,
      challenge,
      permalink,
      // add our own nonce (to mitigate the case of the malicious server)
      nonce: genNonce(),
      tip: 100000 //getTip({ node, sender })
    }
  })

  debug('sending challenge response')
  try {
    yield post(AUTH_ENDPOINT, signed.object)
  } catch (err) {
    this.emit('error', err)
    throw err
  }

  debug('authenticated')
  this.emit('authenticated')

  debug('initializing mqtt client')
  const client = this._client = awsIot.device({
    region,
    protocol: 'wss',
    accessKeyId: accessKey,
    secretKey: secretKey,
    sessionToken: sessionToken,
    port: 443,
    host: iotEndpoint,
    clientId: this._clientId,
    encoding: this._encoding
  })

  this._publish = pify(client.publish.bind(client))
  this._subscribe = pify(client.subscribe.bind(client))

  client.on('connect', this._onconnect)
  client.on('message', this._onmessage)
  client.on('error', this._onerror)
  client.on('reconnect', this._onreconnect)
  client.on('offline', this._onoffline)
  client.on('close', this._onclose)
})

Client.prototype._onerror = function (err) {
  debug('error', err)
  this.emit('error', err)
}

Client.prototype._onconnect = function () {
  debug('connected')
  this.emit('connect')
  this._subscribe(`${this._clientId}/message`, { qos: 1 })
    .then(() => this.emit('subscribe'))
}

Client.prototype._onmessage = function (topic, payload) {
  debug(`received "${topic}" event`)

  switch (topic) {
  case `${this._clientId}/message`:
    const { messages } = JSON.parse(payload)
    messages.forEach(message => {
      try {
        console.timeEnd('ROUNDTRIP: ' + message.object.time)
      } catch (err) {}

      this.emit('message', message)
    })
    break
  case `${this._clientId}/ack`:
    break
  }
}

Client.prototype._onoffline = function () {
  debug('offline')
}

Client.prototype._onreconnect = function () {
  debug('reconnected')
}

Client.prototype._onclose = function () {
  this.emit('disconnect')
  debug('closed')
}

Client.prototype.send = loudCo(function* (message) {
  if (!this._authenticated) {
    yield new Promise(resolve => this.once('authenticated', resolve))
  }

  message = message.unserialized.object
  console.time('ROUNDTRIP: ' + message.object.time)
  yield this._publish('message', JSON.stringify(message), {
    qos: 1
  })

  // this.emit('sent', message)
})

const post = loudCo(function* (url, data) {
  const res = yield fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  const text = yield res.text()
  if (res.status > 300) {
    throw new Error(text)
  }

  if (text.length) return JSON.parse(text)

  return text
})

function genClientId (permalink) {
  return permalink + crypto.randomBytes(20).toString('hex')
}

function genNonce () {
  return crypto.randomBytes(32).toString('hex')
}

function loudCo (gen) {
  return co(function* (...args) {
    try {
      return yield co(gen).apply(this, args)
    } catch (err) {
      console.error(err)
      throw err
    }
  })
}
