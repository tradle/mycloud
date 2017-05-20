const debug = require('debug')('tradle:sls:init-identity')
const Objects = require('./objects')
const Secrets = require('./secrets')
const { loudCo } = require('./utils')
const { exportKeys } = require('./crypto')
const Identities = require('./identities')
const { utils } = require('@tradle/engine')
const {
  IDENTITY_KEYS_KEY
} = require('./constants')

const {
  NETWORK_NAME
} = process.env

const saveIdentityAndKeys = loudCo(function* ({ object, link, keys }) {
  const permalink = link
  keys = exportKeys(keys)

  yield [
    // TODO: encrypt
    // private
    Secrets.putSecretObject(IDENTITY_KEYS_KEY, { link, permalink, object, keys }),
    // public
    Objects.putObject({ link, permalink, object })
  ];

  yield Identities.addContact({ link, permalink, object })
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

  const result = yield createIdentity({ networkName: NETWORK_NAME })
  yield saveIdentityAndKeys(result)
})

module.exports = {
  initialize
}
