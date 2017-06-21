const debug = require('debug')('tradle:sls:init-identity')
const Objects = require('./objects')
const Secrets = require('./secrets')
const { PublicConfBucket } = require('./buckets')
const { loudCo } = require('./utils')
const { exportKeys } = require('./crypto')
const Identities = require('./identities')
const { utils } = require('@tradle/engine')
const {
  IDENTITY_KEYS_KEY,
  PUBLIC_CONF_BUCKET
} = require('./constants')

const { BLOCKCHAIN } = require('./env')

const saveIdentityAndKeys = loudCo(function* ({ object, link, keys }) {
  const permalink = link
  keys = exportKeys(keys)
  const pub = { link, permalink, object }
  const priv = { link, permalink, object, keys }

  yield [
    // TODO: encrypt
    // private
    Secrets.putSecretObject(IDENTITY_KEYS_KEY, priv),
    // public
    Objects.putObject(pub),
    PublicConfBucket.putJSON(PUBLIC_CONF_BUCKET.identity, pub)
  ];

  yield Identities.addContact(pub)
})

function createIdentity (opts) {
  const object = require('../test/fixtures/alice/identity.json')
  let keys = require('../test/fixtures/alice/keys.json')
  keys = keys.map(utils.importKey)
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

const initialize = loudCo(function* () {
  let existing
  try {
    existing = yield Secrets.getSecretObject(IDENTITY_KEYS_KEY)
    debug('existing keys', existing)
  } catch (err) {}

  if (existing) throw new Error('already initialized')

  const result = yield createIdentity({ networkName: BLOCKCHAIN.network })
  yield saveIdentityAndKeys(result)
})

module.exports = {
  initialize
}
