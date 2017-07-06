if (process.env.NODE_ENV === 'test') {
  // require('debug').enable('*tradle*')
  require('xtend/mutable')(process.env, require('../../../real-env'))
}

const mockery = require('mockery')
mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
})

mockery.registerSubstitute('q', 'bluebird-q')

const co = require('co').wrap
const debug = require('debug')('λ:clienttest')
const Client = require('@tradle/aws-client')
const { utils } = require('@tradle/engine')
const contexts = require('@tradle/engine/test/contexts')
const { API_ENDPOINT } = process.env
const wrap = require('../wrap')
const getMe = require('../').provider.getMyIdentity()
const allUsers = require('../../test/fixtures/users')

exports.handler = wrap(function* (event={}, context) {
  const {
    // table,
    concurrency=1,
  } = event

  const nodes = contexts
    .nUsers(concurrency)
    .map(node => utils.promisifyNode(node))

  return Promise.all(nodes.map(pingPong))
})

const pingPong = co(function* (node, i) {
  const promisePong = awaitType(node, 'tradle.Pong')
  const me = yield getMe
  const { permalink } = me
  const client = new Client({
    node,
    counterparty: permalink,
    endpoint: API_ENDPOINT,
    clientId: `${node.permalink}${node.permalink}`
  })

  const promiseAck = new Promise(resolve => client.once('ack', resolve))

  client.on('error', err => {
    throw err
  })

  client.onmessage = co(function* (msg) {
    debug(`receiving ${msg.object._t} ${utils.hexLink(msg)} from ${permalink}`)
    yield node.receive(msg, { permalink })
  })

  node._send = wrap(function* (message, recipientInfo) {
    yield client.send({
      message,
      link: message.unserialized.link
    })
  })

  yield node.addContact(me.object)
  yield client.ready()

  yield node.signAndSend({
    to: { permalink },
    object: {
      _t: 'tradle.SelfIntroduction',
      identity: node.identity
    }
  })

  yield node.signAndSend({
    to: { permalink },
    object: {
      _t: 'tradle.Ping'
    }
  })

  yield promiseAck
  debug('delivered SelfIntroduction')
  yield promisePong
  debug('received pong')
  yield node.destroy()
  yield client.close()
})

function awaitType (node, type) {
  return awaitEvent(node, 'message', ({ object }) => object.object._t === type)
}

function awaitEvent (node, event, filter=acceptAll) {
  return new Promise(resolve => {
    node.on(event, checkEvent)

    function checkEvent (data) {
      debugger
      if (filter(data)) {
        node.removeListener('event', checkEvent)
        resolve()
      }
    }
  })
}

function acceptAll () {
  return true
}

if (process.env.NODE_ENV === 'test') {
  exports.handler()
}
