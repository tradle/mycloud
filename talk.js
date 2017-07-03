const path = require('path')
const debug = require('debug')('tradle:sls:test')
const co = require('co').wrap
const once = require('once')
const extend = require('xtend/mutable')
const fetch = require('isomorphic-fetch')
const levelup = require('levelup')
const leveldown = require('leveldown')
const mkdirp = require('mkdirp')
const Blockchain = require('@tradle/cb-blockr')
const tradle = require('@tradle/engine')
const Client = require('@tradle/aws-client')
const getNetworkAdapter = require('./project/lib/blockchain-adapter').bitcoin
const Restore = require('@tradle/restore')
const BASE_URL = 'https://tyvtq6efah.execute-api.us-east-1.amazonaws.com/dev/tradle'
// const { loudCo } = require('./project/lib/utils')
// const { sign, getSigningKey, extractSigPubKey } = require('./project/lib/crypto')
const keys = require('./project/test/fixtures/bob/keys')
const bob = require('./project/test/fixtures/bob/object')
const challenge = process.env[2]
const key = getSigningKey(keys)
const alice = require('./project/test/fixtures/alice/object')
const aliceKey = alice.object.pubkeys[2]
const recipientPubKey = {
  curve: 'p256',
  pub: new Buffer(aliceKey.pub, 'hex')
}

const { permalink } = bob
// const clientId = `${permalink}${crypto.randomBytes(10).toString('hex')}`

const dir = './clienttest'

// const node = {
//   permalink,
//   identity: bob.object,
//   sign: function ({ object }) {
//     return sign({ key, object })
//   },
//   signAndSend: loudCo(function* ({ object }) {
//     const signed = yield node.sign({ object })
//     const mesasge = yield node.sign({
//       object: {
//         _t: 'tradle.Message'
//       }
//     })
//   })
// }

const prepare = co(function* () {
  mkdirp.sync(dir)
  const networkOpts = getNetworkAdapter({
    networkName: 'testnet'
  })

  const keeperPath = path.join(dir, 'keeper.db')
  const node = tradle.utils.promisifyNode(tradle.node(extend({
    dir,
    keeper: tradle.utils.levelup(keeperPath, { leveldown }),
    identity: bob.object,
    keys: keys,
    blockchain: new Blockchain('testnet'),
    leveldown,
    name: 'bob'
  }, networkOpts)))

  node._send = co(function* (msg, recipientInfo, cb) {
    yield prepare
    yield client.ready()
    // console.log('HAHAHA!')
    console.time('ROUNDTRIP')
    console.time('delivery')
    // client.send(msg.unserialized.object)
    try {
      yield client.send({
        link: msg.unserialized.link,
        message: msg
      })
    } catch (err) {
      if (err.type === 'timetravel') {
        return cb(new tradle.errors.WillNotSend(err.message))
      }

      console.error(err.stack)
      return cb(err)
    }

    console.timeEnd('delivery')
    cb()
  })

  node.on('message', function ({ object }) {
    console.timeEnd('ROUNDTRIP')
    console.log('received', prettify(object.object))
  })

  const res = yield fetch(`${BASE_URL}/info`)
  const { bot } = yield res.json()
  const identity = bot.pub
  const { link, permalink } = tradle.utils.getLinks({ object: identity })
  yield node.addContact(identity)
  const position = yield {
    sent: getTip({ node, counterparty: permalink, sent: true }),
    received: getTip({ node, counterparty: permalink })
  }

  // const tip = yield new Promise((resolve, reject) => {
  //   const monitor = Restore.conversation.monitorTip({
  //     node,
  //     counterparty: permalink,
  //     onChange: once(function (err, tip) {
  //       if (err) return reject(err)

  //       resolve(tip)
  //     })
  //   })
  // })

  const client = new Client({
    endpoint: BASE_URL,
    node,
    position,
    clientId: `${node.permalink}${node.permalink}`
  })

  client.onmessage = co(function* (message) {
    debug('receiving')
    try {
      yield node.receive(message, { permalink })
    } catch (err) {
      if (err.type === 'exists') {
        debug('ignoring duplicate message', err.stack)
        return
      }

      debug('failed to receive message', err.stack)
      return
    }

    debug('received')
  })

  return {
    node,
    client,
    position,
    link,
    permalink,
    identity
  }
})()

prepare.then(co(function* ({ node, client }) {
  yield client.ready()
  yield sendMessage({ node, client })
}))
.catch(err => console.error(err.stack))

// ;['authenticated', 'connect', 'message', 'close', 'error'].forEach(event => {
//   client.on(event, function (...args) {
//     console.log(event.toUpperCase(), ...args)
//   })
// })

function sendMessage ({ node, client }) {
  return node.signAndSend({
    to: { permalink: alice.permalink },
    object: {
      _t: 'tradle.SimpleMessage',
      message: 'hey hey hey alice!'
    },
    other: {
      time: client.now()
    }
  })
  // .then(() => {
  //   setTimeout(sendMessage, 10000)
  // }, console.error)
}

function getSigningKey (keys) {
  return keys.find(key => key.type === 'ec' && key.purpose === 'sign')
}

function getTip ({ node, counterparty, sent }) {
  const from = sent ? node.permalink : counterparty
  const to = sent ? counterparty : node.permalink
  const seqOpts = {}
  const base = from + '!' + to
  seqOpts.gte = base + '!'
  seqOpts.lte = base + '\xff'
  seqOpts.reverse = true
  seqOpts.limit = 1
  // console.log(seqOpts)
  const source = node.objects.bySeq(seqOpts)
  return new Promise((resolve, reject) => {
    source.on('error', reject)
    source.on('data', data => resolve({
      time: data.timestamp,
      link: data.link
    }))

    source.on('end', () => resolve(null))
  })
}

function prettify (obj) {
  return JSON.stringify(obj, null, 2)
}

// client.once('authenticated', loudCo(function* () {
//   const msg = yield node.sign({
//     _t: 'tradle.SimpleMessage',
//     message: 'hey'
//   })

//   yield client.send('message', msg.object)
// }))

// co(function* () {
//   const { challenge } = yield post(`https://7dmn0o7i1j.execute-api.us-east-1.amazonaws.com/dev/tradle/preauth`, { clientId, permalink })
//   const signed = yield sign({
//     key,
//     object: {
//       _t: 'tradle.ChallengeResponse',
//       clientId,
//       challenge,
//       permalink,
//       // add our own nonce (to mitigate the case of the malicious server)
//       nonce: crypto.randomBytes(20).toString('hex')
//     }
//   })

//   yield post('https://7dmn0o7i1j.execute-api.us-east-1.amazonaws.com/dev/tradle/auth', signed.object)


// })()
// .catch(console.error)

// function post (url, data) {
//   return fetch(url, {
//     method: 'POST',
//     headers: {
//       'Accept': 'application/json',
//       'Content-Type': 'application/json'
//     },
//     body: JSON.stringify(data)
//   })
//   .then(co(function* (res) {
//     const text = yield res.text()
//     console.log(text, res.status)
//     if (res.status > 300) {
//       throw new Error(text)
//     }

//     if (text.length) return JSON.parse(text)

//     return text
//   }))
// }

