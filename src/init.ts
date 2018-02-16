import _ = require('lodash')
import { utils as tradleUtils } from '@tradle/engine'
import crypto = require('./crypto')
import { bindAll, co, setVirtual, ensureTimestamped } from './utils'
import Errors = require('./errors')
import models = require('./models')
import {
  TYPE,
  TYPES,
  PUBLIC_CONF_BUCKET,
  IDENTITY_KEYS_KEY
} from './constants'

const { IDENTITY } = TYPES
const debug = require('debug')('tradle:sls:init')
const { getLink, addLinks, getIdentitySpecs, getChainKey, genIdentity } = crypto
const { exportKeys } = require('./crypto')

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
}

const proto = Initializer.prototype

proto.ensureInitialized = co(function* (opts) {
  const initialized = yield this.isInitialized()
  if (!initialized) {
    yield this.init(opts)
  }
})

proto.init = co(function* (opts={}) {
  const [result] = yield Promise.all([
    this.initIdentity(opts),
    // this.enableBucketEncryption()
  ])

  return result
})

proto.initIdentity = co(function* (opts) {
  const result = yield this.genIdentity()
  yield this.write({
    ...result,
    ...opts
  })

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

// proto.enableBucketEncryption = co(function* () {
//   yield this.buckets.Secrets.enableEncryption()
// })

proto.genIdentity = co(function* () {
  const priv = yield genIdentity(getIdentitySpecs({
    networks: this.networks
  }))

  const pub = priv.identity
  ensureTimestamped(pub)
  this.objects.addMetadata(pub)
  setVirtual(pub, { _author: pub._permalink })

  debug('created identity', JSON.stringify(pub))
  return {
    pub,
    priv
  }
})

proto.write = co(function* (opts) {
  const { priv, pub, force } = opts
  if (!force) {
    try {
      const existing = yield this.secrets.get(IDENTITY_KEYS_KEY)
      if (!_.isEqual(existing, priv)) {
        throw new Errors.Exists('refusing to overwrite identity keys. ' +
          'If you\'re absolutely sure you want to do this, use the "force" flag')
      }
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
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
    this.db.put(pub)
  ];

  const { network } = this
  const chainKey = getChainKey(priv.keys, {
    type: network.flavor,
    networkName: network.networkName
  })

  yield Promise.all([
    this.identities.addContact(pub),
    this.seals.create({
      type: IDENTITY,
      counterparty: null,
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
    Errors.ignore(err, Errors.NotFound)
  }

  const link = priv && getLink(priv.identity)
  debug(`terminating provider ${link}`)
  const { PublicConf } = this.buckets
  yield [
    link ? this.objects.del(link) : Promise.resolve(),
    this.secrets.del(IDENTITY_KEYS_KEY),
    // public
    PublicConf.del(PUBLIC_CONF_BUCKET.identity)
  ]

  debug(`terminated provider ${link}`)
})

// function getTestIdentity () {
//   const object = require('./test/fixtures/alice/identity.json')
//   const keys = require('./test/fixtures/alice/keys.json')
//   // keys = keys.map(utils.importKey)
//   // const link = getLink(object)
//   // const permalink = link
//   // return { object, keys, link, permalink }
//   addLinks(object)
//   return { identity: object, keys }
// }

export = Initializer
