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

function Environment () {
  this.require = lazy(require, this)

  this.env = ENV
  this.aws = this.require('aws', './aws')
  this.networks = this.require('networks', './networks')

  let network
  this.__defineGetter__('network', () => {
    if (!network) {
      network = this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName]
    }

    return network
  })

  let blockchain
  this.__defineGetter__('blockchain', function () {
    if (blockchain) return blockchain

    const createBlockchainAPI = require('./blockchain')
    return blockchain = createBlockchainAPI(this.network)
  })

  let seals
  this.__defineGetter__('seals', () => {
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
  this.__defineGetter__('faucet', function () {
    if (!faucet) {
      faucet = require('./faucet')({
        networkName: BLOCKCHAIN.networkName,
        privateKey: FAUCET_PRIVATE_KEY
      })
    }

    return faucet
  })

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
}

exports = module.exports = new Environment()
exports.new = () => new Environment()
