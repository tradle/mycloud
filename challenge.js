const crypto = require('crypto')
const fetch = require('node-fetch')
const levelup = require('levelup')
const leveldown = require('leveldown')
const Blockchain = require('@tradle/cb-blockr')
const tradle = require('@tradle/engine')
const Client = require('./client')
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

const node = tradle.utils.promisifyNode(tradle.node({
  networkName: 'testnet',
  dir: './clienttest',
  keeper: tradle.utils.levelup('./clienttest/keeper.db'),
  identity: bob.object,
  keys: keys,
  blockchain: new Blockchain('testnet'),
  leveldown,
  name: 'bob'
}))

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

const client = new Client({
  // clientId: `${node.permalink}${node.permalink}`
})

client.setNode(node)

// ;['authenticated', 'connect', 'message', 'close', 'error'].forEach(event => {
//   client.on(event, function (...args) {
//     console.log(event.toUpperCase(), ...args)
//   })
// })

node._send = function (msg, recipientInfo, cb) {
  console.time('delivery')
  client.send(msg)
    .then(function (result) {
      console.timeEnd('delivery')
      cb()
    }, function (err) {
      console.error(err.stack)
      cb(err)
    })
    // .then(() => cb(), cb)
}

node.addContact(alice.object)
  .then(sendMessage, sendMessage)
  .catch(console.error)

function sendMessage () {
  return node.signAndSend({
    to: { permalink: alice.permalink },
    object: {
      _t: 'tradle.SimpleMessage',
      message: 'hey alice!',
      time: Date.now()
    }
  })
  // .then(() => {
  //   setTimeout(sendMessage, 10000)
  // }, console.error)
}

function getSigningKey (keys) {
  return keys.find(key => key.type === 'ec' && key.purpose === 'sign')
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
