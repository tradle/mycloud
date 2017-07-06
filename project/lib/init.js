const debug = require('debug')('tradle:sls:init')
const co = require('co').wrap
const promisify = require('pify')
const deepEqual = require('deep-equal')
const omit = require('object.omit')
const clone = require('xtend')
const { utils } = require('@tradle/engine')
const {
  ORG_NAME,
  ORG_DOMAIN,
  ORG_LOGO,
  LOGO_UNKNOWN,
  BLOCKCHAIN
} = require('./env')

const {
  buckets,
  constants,
  secrets,
  objects,
  errors,
  identities,
  provider
} = require('./')

const { exportKeys } = require('./crypto')
const {
  TYPE,
  PUBLIC_CONF_BUCKET,
  IDENTITY_KEYS_KEY,
  PERMALINK,
  LINK
} = constants

const ORG_PARAMS = {
  name: ORG_NAME,
  logo: ORG_LOGO,
  domain: ORG_DOMAIN,
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

const ensureInitialized = co(function* (options=ORG_PARAMS) {
  const initialized = yield isInitialized()
  if (!initialized) {
    yield init(options)
  }
})

const init = co(function* (options) {
  const result = yield createProvider(options)
  result.force = options.force
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

const createProvider = co(function* ({ name, domain, logo }) {
  if (!(name && domain)) {
    throw new Error('"name" is required')
  }

  debug(`initializing provider ${name}`)

  if (!logo || !/^data:/.test(logo)) {
    const ImageUtils = require('./image-utils')
    try {
      logo = yield ImageUtils.getLogo({ logo, domain })
    } catch (err) {
      debug(`unable to load logo for domain: ${domain}`)
      logo = LOGO_UNKNOWN
    }
  }

  const priv = yield createIdentity({
    networkName: BLOCKCHAIN.networkName
  })

  debug('created identity', JSON.stringify(priv))
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

  const { PublicConf } = buckets
  yield [
    // TODO: encrypt
    // private
    secrets.put(IDENTITY_KEYS_KEY, priv),
    // public
    objects.putObject(pub),
    PublicConf.putJSON(PUBLIC_CONF_BUCKET.identity, pub),
    PublicConf.putJSON(PUBLIC_CONF_BUCKET.info, {
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
  const { PublicConf } = buckets
  yield [
    priv && objects.del(priv.link),
    secrets.del(IDENTITY_KEYS_KEY),
    // public
    PublicConf.del(PUBLIC_CONF_BUCKET.identity),
    PublicConf.del(PUBLIC_CONF_BUCKET.info)
  ]

  debug(`terminated provider ${priv && priv.link}`)
})

function getTestIdentity () {
  const object = require('../test/fixtures/alice/identity.json')
  const keys = require('../test/fixtures/alice/keys.json')
  // keys = keys.map(utils.importKey)
  const link = utils.hexLink(object)
  const permalink = link
  return { object, keys, link, permalink }
}

const _createIdentity = promisify(utils.newIdentity)
const createIdentity = co(function* (opts) {
  if (process.env.NODE_ENV === 'test') {
    return getTestIdentity()
  }

  const { link, identity, keys } = yield _createIdentity(opts)
  return {
    link,
    permalink: link,
    object: identity,
    keys: exportKeys(keys)
  }
})

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
