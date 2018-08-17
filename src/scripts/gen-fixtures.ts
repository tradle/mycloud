#!/usr/bin/env node
require('../test/env').install()

import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import promisify from 'pify'
// @ts-ignore
import Promise from 'bluebird'
import { utils } from '@tradle/engine'
import randomName from 'random-name'
import { exportKeys } from '../crypto'
import { getIdentitySpecs } from '../crypto'
import { createTestProfile } from '../test/utils'
import { setVirtual } from '../utils'
import networks from '../networks'

const helpers = require('@tradle/engine/test/helpers')
const identityOpts = getIdentitySpecs({ networks })
const genUser = promisify(utils.newIdentity)
const genUsers = n => Promise.map(new Array(n).fill(0), async () => {
  const user = await genUser(identityOpts)
  user.profile = createTestProfile()
  return user
})

const base = path.resolve(__dirname, '../../src/test/fixtures')

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
//   const [me, them] = await [createIdentity(), createIdentity()]
//   const permalink = link
//   const fromMe = me.createMessage({
//     author: meObject,
//     to:
//   })

//   await Promise.all([
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

// ;(async () => {
//   const users = await genUsers(10)
//   users.forEach(user => {
//     user.keys = exportKeys(user.keys.map(key => utils.importKey(key)))
//   })

//   fs.writeFileSync(`${base}/users-pem.json`, prettify(users))
// })()

;(async () => {
  const users = await genUsers(500)
  fs.writeFileSync(`${base}/users.json`, prettify(users))
})();

;(async () => {
  const users = await genUsers(2)
  const friends = users
    .map((user, i) => helpers.userToOpts(user, i ? 'alice' : 'bob'))
    .map(helpers.createNode)
    .map(node => utils.promisifyNode(node))

  await promisify(helpers.meet)(friends)

  const [ alice, bob ] = friends
  helpers.connect(friends)

  const eachToGet = 2
  let togo = eachToGet * 2
  let firstTimestamp = Date.now()

  const received = {}
  friends.forEach(node => {
    received[node.name] = []

    mkdirp.sync(`${base}/${node.name}`)
    fs.writeFileSync(`${base}/${node.name}/identity.json`, prettify(node.identityInfo.object))
    fs.writeFileSync(`${base}/${node.name}/object.json`, prettify({
      object: node.identityInfo.object,
      link: node.link,
      permalink: node.permalink
    }))

    fs.writeFileSync(`${base}/${node.name}/keys.json`, prettify(exportKeys(node.keys)))
    node.on('message', function ({ object, author, permalink, link, objectinfo }) {
      setVirtual(object.object, {
        _permalink: objectinfo.permalink,
        _link: objectinfo.link,
      })

      setVirtual(object, {
        _permalink: permalink,
        _link: link,
      })

      received[node.name].push(object)
      if (--togo) return

      friends.forEach(node => {
        fs.writeFileSync(`${base}/${node.name}/receive.json`, prettify(received[node.name]))
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
})()
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
