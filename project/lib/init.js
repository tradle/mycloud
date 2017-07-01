const debug = require('debug')('tradle:sls:init')
const co = require('co').wrap
const promisify = require('pify')
const deepEqual = require('deep-equal')
const omit = require('object.omit')
const clone = require('xtend')
const { utils } = require('@tradle/engine')
const { ORG } = require('./env')
const {
  buckets,
  constants,
  secrets,
  objects,
  errors,
  identities,
  provider
} = require('./')

const { PublicConfBucket } = buckets
const {
  TYPE,
  PUBLIC_CONF_BUCKET,
  IDENTITY_KEYS_KEY,
  PERMALINK,
  LINK
} = constants

const ORG_PARAMS = {
  name: ORG.ORG_NAME,
  logo: ORG.ORG_LOGO,
  domain: ORG.ORG_DOMAIN,
}

function getHandleFromName (name) {
  return name.replace(/[^A-Za-z]/g, '').toLowerCase()
}

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

const ensureInitialized = co(function* (options) {
  const initialized = yield isInitialized()
  if (!initialized) {
    yield init(options)
  }
})

const init = co(function* (options=ORG_PARAMS) {
  const result = yield createProvider(options)
  yield push(result)
  return result
})

const isInitialized = (function () {
  let initialized
  return co(function* () {
    if (!initialized) {
      initialized = yield secrets.exists(IDENTITY_KEYS_KEY)
    }

    return initialized
  })
}())

const createProvider = co(function* (options) {
  const { name, logo, force } = options
  if (!(name && logo)) {
    throw new Error('"name" and "logo" are required')
    // if (!force) {
    //   console.error('"name" and "logo" are required')
    //   return
    // }
  }

  debug(`initializing provider ${name}`)

  const priv = yield createIdentity()
  const pub = omit(priv, 'keys')
  const org = yield provider.signObject({
    author: priv,
    object: getOrgObj({ name, logo })
  })

  return {
    org: org.object,
    pub,
    priv,
    publicConfig: defaults.publicConfig,
    style: defaults.style
  }
})

const push = co(function* (options) {
  const { priv, pub, publicConfig, org, style, force } = options
  if (!force) {
    try {
      const existing = yield secrets.get(IDENTITY_KEYS_KEY)
      if (!deepEqual(existing, priv)) {
        throw new Error('refusing to overwrite identity keys')
      }
    } catch (err) {
      if (!(err instanceof errors.NotFound)) {
        throw err
      }
    }
  }

  yield [
    // TODO: encrypt
    // private
    secrets.put(IDENTITY_KEYS_KEY, priv),
    // public
    objects.putObject(pub),
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

  yield identities.addContact(pub)
})

const clear = co(function* () {
  let priv
  try {
    priv = yield secrets.get(IDENTITY_KEYS_KEY)
  } catch (err) {
    if (!(err instanceof errors.NotFound)) {
      throw err
    }
  }

  debug(`terminating provider ${priv && priv.link}`)
  yield [
    priv && objects.del(priv.link),
    secrets.del(IDENTITY_KEYS_KEY),
    // public
    PublicConfBucket.del(PUBLIC_CONF_BUCKET.identity),
    PublicConfBucket.del(PUBLIC_CONF_BUCKET.info)
  ]

  debug(`terminated provider ${priv && priv.link}`)
})

function createIdentity (opts) {
  const object = require('../test/fixtures/alice/identity.json')
  const keys = require('../test/fixtures/alice/keys.json')
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

function getOrgObj ({ name, logo }) {
  return clone(defaults.org, {
    name,
    photos: [
      {
        url: logo
      }
    ]
  })
}

module.exports = {
  ensureInitialized,
  init,
  push,
  clear
}
