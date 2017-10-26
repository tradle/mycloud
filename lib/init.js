const debug = require('debug')('tradle:sls:init')
const tradleUtils = require('@tradle/engine').utils
const crypto = require('./crypto')
const utils = require('./utils')
const errors = require('./errors')
const models = require('./models')
const {
  TYPE,
  PUBLIC_CONF_BUCKET,
  IDENTITY_KEYS_KEY,
  TABLES_TO_PRECREATE
} = require('./constants')

const { getLink, addLinks, getIdentitySpecs, getChainKey } = crypto
const { omitVirtual, setVirtual, omit, deepEqual, clone, bindAll, promisify, co } = utils
const {
  LOGO_UNKNOWN
} = require('../conf/media')

const { exportKeys } = require('./crypto')
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

module.exports = Initializer

function Initializer ({
  env,
  networks,
  network,
  secrets,
  provider,
  buckets,
  objects,
  identities,
  seals,
  models,
  db
}) {
  bindAll(this)

  this.env = env
  this.secrets = secrets
  this.networks = networks
  this.network = network
  this.provider = provider
  this.buckets = buckets
  this.objects = objects
  this.identities = identities
  this.seals = seals
  this.models = models
  this.db = db
  const {
    ORG_NAME,
    ORG_DOMAIN,
    ORG_LOGO,
    BLOCKCHAIN
  } = env

  this.orgOpts = {
    name: ORG_NAME,
    logo: ORG_LOGO,
    domain: ORG_DOMAIN,
  }
}

const proto = Initializer.prototype

proto.ensureInitialized = co(function* (opts) {
  const initialized = yield this.isInitialized()
  if (!initialized) {
    yield this.init(opts)
  }
})

proto.init = co(function* (opts) {
  opts = clone(this.orgOpts, opts)
  const result = yield this.createProvider(opts)
  result.force = opts.force
  yield this.write(result)
  return result
})

proto.isInitialized = (function () {
  let initialized
  return co(function* () {
    if (!initialized) {
      initialized = yield this.secrets.exists(IDENTITY_KEYS_KEY)
    }

    return initialized
  })
}())

proto.createProvider = co(function* (opts) {
  let { name, domain, logo } = opts
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

  const priv = yield createIdentity(getIdentitySpecs({
    networks: this.networks
  }))

  const pub = priv.identity
  debug('created identity', JSON.stringify(pub))

  const org = yield this.provider.signObject({
    author: priv,
    object: getOrgObj({ name, logo })
  })

  return {
    org,
    pub,
    priv,
    publicConfig: defaults.publicConfig,
    style: defaults.style
  }
})

proto.write = co(function* (opts) {
  const { priv, pub, publicConfig, org, style, force } = opts
  if (!force) {
    try {
      const existing = yield this.secrets.get(IDENTITY_KEYS_KEY)
      if (!deepEqual(existing, priv)) {
        throw new Error('refusing to overwrite identity keys')
      }
    } catch (err) {
      if (!(err instanceof errors.NotFound)) {
        throw err
      }
    }
  }

  const { PublicConf } = this.buckets
  yield [
    // TODO: encrypt
    // private
    this.secrets.put(IDENTITY_KEYS_KEY, priv),
    // public
    this.objects.put(pub),
    PublicConf.putJSON(PUBLIC_CONF_BUCKET.identity, pub),
    PublicConf.putJSON(PUBLIC_CONF_BUCKET.info, {
      bot: {
        profile: {
          name: {
            firstName: `${org.name} Bot`
          }
        },
        pub: omitVirtual(pub)
      },
      id: getHandleFromName(org.name),
      org: omitVirtual(org),
      publicConfig,
      style
    })
  ];

  const { network } = this
  const chainKey = getChainKey(priv.keys, {
    type: network.flavor,
    networkName: network.networkName
  })

  yield Promise.all([
    this.identities.addContact(pub),
    this.seals.create({
      key: chainKey,
      link: pub._link
    })
  ])
})

proto.clear = co(function* () {
  let priv
  try {
    priv = yield this.secrets.get(IDENTITY_KEYS_KEY)
  } catch (err) {
    if (!(err instanceof errors.NotFound)) {
      throw err
    }
  }

  const link = priv && getLink(priv.identity)
  debug(`terminating provider ${link}`)
  const { PublicConf } = this.buckets
  yield [
    link ? this.objects.del(link) : Promise.resolve(),
    this.secrets.del(IDENTITY_KEYS_KEY),
    // public
    PublicConf.del(PUBLIC_CONF_BUCKET.identity),
    PublicConf.del(PUBLIC_CONF_BUCKET.info)
  ]

  debug(`terminated provider ${link}`)
})

// function getTestIdentity () {
//   const object = require('../test/fixtures/alice/identity.json')
//   const keys = require('../test/fixtures/alice/keys.json')
//   // keys = keys.map(utils.importKey)
//   // const link = getLink(object)
//   // const permalink = link
//   // return { object, keys, link, permalink }
//   addLinks(object)
//   return { identity: object, keys }
// }

const _createIdentity = promisify(tradleUtils.newIdentity)
const createIdentity = co(function* (opts) {
  // if (process.env.NODE_ENV === 'test') {
  //   return getTestIdentity()
  // }

  const { link, identity, keys } = yield _createIdentity(opts)
  setVirtual({
    _link: link,
    _permalink: link
  })

  return {
    identity,
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
