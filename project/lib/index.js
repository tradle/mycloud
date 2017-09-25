const debug = require('debug')('tradle:sls')
const ENV = require('./env')
const { toCamelCase, splitCamelCase } = require('./string-utils')
const cachifiable = {
  Objects: true
}

function Tradle (env) {
  const {
    FAUCET_PRIVATE_KEY,
    BLOCKCHAIN,
    SERVERLESS_PREFIX
  } = env

  this.env = env
  this.prefix = SERVERLESS_PREFIX

  // singletons
  this.require('aws', './aws')
  this.require('networks', './networks')
  this.require('models', './models')
  this.require('constants', './constants')
  this.require('errors', './errors')
  this.require('crypto', './crypto')
  this.require('utils', './utils')
  this.require('stringUtils', './string-utils')
  this.require('dbUtils', './db-utils')
  this.require('wrap', './wrap')

  // instances
  this.define('network', () =>
    this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName])

  this.define('blockchain', './blockchain', createBlockchainAPI =>
    createBlockchainAPI(this.network))

  this.define('seals', './seals')

  // this.define('faucet', './faucet', createFaucet => createFaucet({
  //   networkName: BLOCKCHAIN.networkName,
  //   privateKey: FAUCET_PRIVATE_KEY
  // }))

  this.define('resources', './resources')
  this.define('tables', './tables')
  this.define('buckets', './buckets')
  this.define('db', './db', instantiate => instantiate(this))
  this.define('s3Utils', './s3-utils')
  this.define('lambdaUtils', './lambda-utils')
  this.define('iot', './iot-utils', instantiate => instantiate({
    prefix: env.IOT_TOPIC_PREFIX
  }))

  this.define('identities', './identities')
  this.define('friends', './friends')
  this.define('messages', './messages')
  this.define('events', './events')
  this.define('provider', './provider')
  this.define('auth', './auth')
  this.define('objects', './objects')
  this.define('secrets', './secrets', instantiate => instantiate({
    bucket: this.buckets.Secrets
  }))

  this.define('init', './init')
  this.define('discovery', './discovery')
  this.define('user', './user')
  this.define('delivery', './delivery')
  this.define('router', './router')
  // this.bot = this.require('bot', './bot')
}

Tradle.prototype.define = function (property, path, instantiator) {
  if (typeof path === 'function') {
    instantiator = path
    path = null
  } else if (!instantiator) {
    instantiator = Ctor => new Ctor(this)
  }

  let instance
  defineGetter(this, property, () => {
    if (!instance) {
      if (path) {
        const subModule = require(path)
        instance = instantiator(subModule)
      } else {
        instance = instantiator()
      }

      debug('defined', property)
    }

    return instance
  })
}

Tradle.prototype.require = function (property, path) {
  // lazy
  defineGetter(this, property, () => require(path))
}

function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, { get })
}

exports = module.exports = new Tradle(ENV)
exports.new =
exports.createInstance = (env=ENV) => new Tradle(env)
