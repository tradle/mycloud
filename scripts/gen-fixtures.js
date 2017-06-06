#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const { utils } = require('@tradle/engine')
const contexts = require('@tradle/engine/test/contexts')
const helpers = require('@tradle/engine/test/helpers')
const { exportKeys } = require('./project/lib/crypto')
// const writeFile = function (relPath, data) {
//   return new Promise((resolve, reject) => {
//     fs.writeFile(path.join(fixturesPath, relPath), JSON.stringify(data, null, 2), function (err) {
//       if (err) return reject(err)
//       resolve()
//     })
//   })
// }

// co(function* () {
//   const [me, them] = yield [createIdentity(), createIdentity()]
//   const permalink = link
//   const fromMe = me.createMessage({
//     author: meObject,
//     to:
//   })

//   yield Promise.all([
//     writeFile('me.json', extend(me, { keys: me.keys.map(key => key.toJSON(true)) } }),
//     writeFile('messageFromMe.json', messageFromMe),
//     writeFile('messageToMe.json', messageToMe),
//   ])
// })()

// function createIdentity () {
//   return newIdentity({ networkName: 'testnet' })
//     .then({ identity, link, keys }) => {
//       return {
//         object: identity,
//         link,
//         permalink: link
//         keys
//       }
//     })
// }

contexts.nFriends(2, function (err, friends) {
  const [ alice, bob ] = friends
  helpers.connect(friends)

  friends.forEach(node => {
    mkdirp.sync(`./project/test/fixtures/${node.name}`)
    fs.writeFileSync(`./project/test/fixtures/${node.name}/identity.json`, prettify(node.identityInfo.object))
    fs.writeFileSync(`./project/test/fixtures/${node.name}/object.json`, prettify({
      object: node.identityInfo.object,
      link: node.link,
      permalink: node.permalink
    }))

    fs.writeFileSync(`./project/test/fixtures/${node.name}/keys.json`, prettify(exportKeys(node.keys)))
    node.on('message', function ({ object }) {
      fs.writeFileSync(`./project/test/fixtures/${node.name}/receive.json`, prettify(object))
    })
  })

  helpers.eachOther(friends, function (a, b, done) {
    a.signAndSend({
      to: b._recipientOpts,
      object: {
        _t: 'tradle.SimpleMessage',
        message: `hey ${b.name}!`
      }
    }, done)
  }, rethrow)
})

function prettify (object) {
  return JSON.stringify(object, null, 2)
}

function rethrow (err) {
  if (err) throw err
}
