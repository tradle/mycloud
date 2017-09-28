#!/usr/bin/env node

const path = require('path')
require('dotenv').config({
  path: path.resolve(__dirname, '../.serverless-resources-env/.us-east-1_dev_onmessage')
})

const extend = require('xtend/mutable')
const promisify = require('pify')
const fs = promisify(require('fs'))
const mkdirp = promisify(require('mkdirp'))
const program = require('commander')
const Discovery = require('../lib/discovery')
const co = require('../lib/utils').loudCo
const aws = require('../lib/aws')
// const { PublicConfBucket } = require('../lib/buckets')
const { init, push, clear } = require('../lib/init')
const DIR = path.resolve('./org')
const FILES = (function () {
  const map = {
    pub: 'identity-pub.json',
    priv: 'identity-priv.json',
    publicConfig: 'public-config.json',
    org: 'org.json',
    style: 'style.json'
  }

  for (let name in map) {
    map[name] = path.join(DIR, map[name])
  }

  return map
}())

function getFiles () {
  const vals = {}
  for (let key in FILES) {
    try {
      vals[key] = require(FILES[key])
    } catch (err) {}
  }

  return vals
}

function printUsage () {
  console.log(`
USAGE:
  ./cmd --logo path/to/logo.(jpg|png) --name MyOrganization`)
}

function writeJSON (file, obj) {
  return fs.writeFile(file, JSON.stringify(obj, null, 2), { encoding: 'utf8' })
}

const writeFiles = co(function* ({ org, pub, priv, publicConfig, style }) {
  yield mkdirp(DIR)
  yield [
    writeJSON(FILES.org, org),
    writeJSON(FILES.pub, pub),
    writeJSON(FILES.priv, priv),
    writeJSON(FILES.publicConfig, publicConfig),
    writeJSON(FILES.style, style)
  ]
})

program
  .version(require('../package.json').version)
  .command('init [options]')
  .option('-n, --name <name>', 'the name of your organization')
  .option('-l, --logo <logo>', `your organization's logo`)
  .option('-f, --force', 'overwrite existing identity / keys')
  .action(co(function* (cmd, options) {
    try {
      const values = yield init(options)
      yield writeFiles(values)
    } catch (err) {
      console.error(err.stack)
    }
  }))

// program
//   .command('push')
//   .option('-f, --force', 'overwrite existing identity / keys')
//   .action(co(function* (cmd, options={}) {
//     try {
//       yield push(extend({ force: cmd.force }, getFiles()))
//     } catch (err) {
//       console.error(err.stack)
//     }
//   }))

program
  .command('destroy')
  .action(co(function* (cmd, options={}) {
    try {
      yield Discovery.discoverServices()
      yield clear()
    } catch (err) {
      console.error(err.stack)
    }
  }))

// program
//   .command('get')
//   .action(co(function* (cmd) {
//     const params = {
//       RoleArn: 'arn:aws:iam:::role/tradle-dev-us-east-1-lambdaRole',
//       RoleSessionName: 'abracadabra' + Math.random(),
//     }

//     yield aws.sts.assumeRole(params).promise()
//     console.log(yield aws.s3.getObject({
//       Bucket: 'tradle-dev-publicconfbucket-gd70s2lfklji',
//       Key: 'info.json'
//     }))
//   }))

program.parse(process.argv)
