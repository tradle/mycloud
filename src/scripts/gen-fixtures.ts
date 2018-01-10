#!/usr/bin/env node
require('../test/env').install()

const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const co = require('co')
const promisify = require('pify')
const { utils } = require('@tradle/engine')
const helpers = require('@tradle/engine/test/helpers')
const { setVirtual } = require('@tradle/validate-resource').utils
const { exportKeys } = require('../crypto')
const { getIdentitySpecs } = require('../crypto')
const networks = require('../networks')
const { createTestProfile } = require('../test/utils')
const identityOpts = getIdentitySpecs({ networks })
const genUser = promisify(utils.newIdentity)
const genUsers = n => new Array(n).fill(0).map(() => {
  return genUser(identityOpts)
    .then(user => {
      user.profile = createTestProfile()
      return user
    })
})

// const genUsers = promisify(helpers.genUsers)

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

co(function* () {
  const users = yield genUsers(10)
  users.forEach(user => {
    user.keys = exportKeys(user.keys.map(key => {
      return utils.importKey(key)
    }))
  })

  fs.writeFileSync(`./test/fixtures/users-pem.json`, prettify(users))
})

co(function* () {
  const users = yield genUsers(2)
  const friends = users
    .map((user, i) => helpers.userToOpts(user, i ? 'alice' : 'bob'))
    .map(helpers.createNode)
    .map(node => utils.promisifyNode(node))

  yield promisify(helpers.meet)(friends)

  const [ alice, bob ] = friends
  helpers.connect(friends)

  const eachToGet = 2
  let togo = eachToGet * 2
  let firstTimestamp = Date.now()

  const received = {}
  friends.forEach(node => {
    received[node.name] = []

    mkdirp.sync(`./test/fixtures/${node.name}`)
    fs.writeFileSync(`./test/fixtures/${node.name}/identity.json`, prettify(node.identityInfo.object))
    fs.writeFileSync(`./test/fixtures/${node.name}/object.json`, prettify({
      object: node.identityInfo.object,
      link: node.link,
      permalink: node.permalink
    }))

    fs.writeFileSync(`./test/fixtures/${node.name}/keys.json`, prettify(exportKeys(node.keys)))
    node.on('message', function ({ object, author, permalink, link, objectinfo }) {
      setVirtual(object.object, {
        _author: objectinfo.author,
        _permalink: objectinfo.permalink,
        _link: objectinfo.link,
        _time: object.time
      })

      setVirtual(object, {
        _author: author,
        _permalink: permalink,
        _link: link,
        _time: object.time
      })

      received[node.name].push(object)
      if (--togo) return

      friends.forEach(node => {
        fs.writeFileSync(`./test/fixtures/${node.name}/receive.json`, prettify(received[node.name]))
        node.destroy(rethrow)
      })
    })
  })

  new Array(eachToGet).fill(0).forEach((n, i) => {
    helpers.eachOther(friends, function (a, b, done) {
      a.signAndSend({
        to: b._recipientOpts,
        object: {
          _t: 'tradle.SimpleMessage',
          message: `${i}. hey ${b.name}!`
        },
        time: nextTimestamp()
      }, done)
    }, rethrow)
  })

  function nextTimestamp () {
    return firstTimestamp++
  }
})
.catch(err => {
  console.error(err)
  process.exit(1)
})

function prettify (object) {
  return JSON.stringify(object, null, 2)
}

function rethrow (err) {
  if (err) throw err
}
