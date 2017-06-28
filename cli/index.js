#!/usr/bin/env node

const path = require('path')
require('dotenv').config({
  path: path.resolve(__dirname, '../.serverless-resources-env/.us-east-1_dev_onmessage')
})

const promisify = require('pify')
const fs = promisify(require('fs'))
const mkdirp = promisify(require('mkdirp'))
const program = require('commander')
const deepEqual = require('deep-equal')
const omit = require('object.omit')
const clone = require('xtend')
const co = require('co').wrap
const { utils } = require('@tradle/engine')
const { buckets, constants } = require('../project')
const { PublicConfBucket } = buckets
const Secrets = require('../project/lib/secrets')
const Objects = require('../project/lib/objects')
const Errors = require('../project/lib/errors')
const Identities = require('../project/lib/identities')
const Provider = require('../project/lib/provider')
const {
  TYPE,
  PUBLIC_CONF_BUCKET,
  IDENTITY_KEYS_KEY,
  PERMALINK,
  LINK
} = constants

const { getHandleFromName, getDataURI } = require('./utils')
const DIR = path.resolve('./org')
const defaults = {
  style: {},
  publicConfig: {
    canShareContext: false,
    hasSupportLine: true
  },
  org: {
    [TYPE]: 'tradle.Organization',
    photos: [],
    currency: '€'
  }
}

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

const push = co(function* (options) {
  const { force } = options
  const priv = require(FILES.priv)
  if (!force) {
    try {
      const existing = yield Secrets.getSecretObject(IDENTITY_KEYS_KEY)
      if (!deepEqual(existing, priv)) {
        throw new Error('refusing to overwrite identity keys')
      }
    } catch (err) {
      if (!(err instanceof Errors.NotFound)) {
        throw err
      }
    }
  }

  const pub = require(FILES.pub)
  const publicConfig = require(FILES.publicConfig)
  const org = require(FILES.org)
  const style = require(FILES.style)
  yield [
    // TODO: encrypt
    // private
    Secrets.putSecretObject(IDENTITY_KEYS_KEY, priv),
    // public
    Objects.putObject(pub),
    PublicConfBucket.putJSON(PUBLIC_CONF_BUCKET.identity, pub),
    PublicConfBucket.putJSON(PUBLIC_CONF_BUCKET.info, {
      bot: {
        profile: {
          name: {
            firstName: `${org.name} Bot`
          }
        },
        pub: pub.object
      },
      id: getHandleFromName(org.name),
      org,
      publicConfig,
      style
    })
  ];

  yield Identities.addContact(pub)
})

function createIdentity (opts) {
  const object = require('../project/test/fixtures/alice/identity.json')
  const keys = require('../project/test/fixtures/alice/keys.json')
  // keys = keys.map(utils.importKey)
  const link = utils.hexLink(object)
  const permalink = link
  return Promise.resolve({
    object,
    keys,
    link,
    permalink
  })

  // return new Promise((resolve, reject) => {
  //   utils.newIdentity(opts, function (err, result) {
  //     if (err) return reject(err)

  //     resolve(result)
  //   })
  // })
}

function printUsage () {
  console.log(`
USAGE:
  ./cmd --logo path/to/logo.(jpg|png) --name MyOrganization`)
}

function writeJSON (file, obj) {
  return fs.writeFile(file, JSON.stringify(obj, null, 2), { encoding: 'utf8' })
}

const init = co(function* (options) {
  const { name, logo, force } = options
  if (!(name && logo)) {
    if (!force) {
      console.error('"name" and "logo" are required')
      return
    }
  }

  const priv = yield createIdentity()
  const pub = omit(priv, 'keys')
  const org = yield Provider.signObject({
    author: priv,
    object: clone(defaults.org, {
      name,
      photos: [
        {
          url: yield getDataURI(path.resolve(logo))
        }
      ]
    })
  })

  yield mkdirp(DIR)
  yield [
    writeJSON(FILES.org, org.object),
    writeJSON(FILES.pub, pub),
    writeJSON(FILES.priv, priv),
    writeJSON(FILES.publicConfig, defaults.publicConfig),
    writeJSON(FILES.style, defaults.style)
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
      yield init(options)
    } catch (err) {
      console.error(err.stack)
    }
  }))

program
  .command('push')
  .option('-f, --force', 'overwrite existing identity / keys')
  .action(co(function* (cmd, options={}) {
    try {
      yield push({ force: cmd.force })
    } catch (err) {
      console.error(err.stack)
    }
  }))

program.parse(process.argv)
