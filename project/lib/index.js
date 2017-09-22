const lazy = require('./lazy')
const ENV = require('./env')
const {
  FAUCET_PRIVATE_KEY,
  BLOCKCHAIN
} = require('./env')

const { toCamelCase, splitCamelCase } = require('./string-utils')
const cachifiable = {
  Objects: true
}

function Tradle () {
  this.require = lazy(require, this)

  this.env = ENV
  this.aws = this.require('aws', './aws')
  this.networks = this.require('networks', './networks')
  this.models = this.require('models', './models')

  let network
  defineGetter(this, 'network', () => {
    if (!network) {
      network = this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName]
    }

    return network
  })

  let blockchain
  defineGetter(this, 'blockchain', () => {
    if (blockchain) return blockchain

    const createBlockchainAPI = require('./blockchain')
    return blockchain = createBlockchainAPI(this.network)
  })

  let seals
  defineGetter(this, 'seals', () => {
    if (!seals) {
      seals = require('./seals')({
        provider: this.provider,
        table: this.tables.Seals,
        blockchain: this.blockchain,
        confirmationsRequired: this.network.confirmations
      })
    }

    return seals
  })

  let faucet
  defineGetter(this, 'faucet', () => {
    if (!faucet) {
      faucet = require('./faucet')({
        networkName: BLOCKCHAIN.networkName,
        privateKey: FAUCET_PRIVATE_KEY
      })
    }

    return faucet
  })

  defineGetter(this, 'db', () => require('./db')())
  this.identities = this.require('identities', './identities')
  this.messages = this.require('messages', './messages')
  this.objects = this.require('objects', './objects')
  this.secrets = this.require('secrets', './secrets')
  this.constants = this.require('constants', './constants')
  this.errors = this.require('errors', './errors')
  this.crypto = this.require('crypto', './crypto')
  this.utils = this.require('utils', './utils')
  this.stringUtils = this.require('stringUtils', './string-utils')
  this.dbUtils = this.require('dbUtils', './db-utils')
  this.s3Utils = this.require('s3Utils', './s3-utils')
  this.resources = this.require('resources', './resources')
  this.tables = this.require('tables', './tables')
  this.buckets = this.require('buckets', './buckets')
  this.provider = this.require('provider', './provider')
  this.bot = this.require('bot', './bot')
  this.auth = this.require('auth', './auth')
}

function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, { get })
}

exports = module.exports = new Tradle()
exports.new = () => new Tradle()
