// const { clone, pick, splitCamelCase } = require('./utils')
// const env = clone(
//   require('../../env'),
//   process.env
// )

// env.BLOCKCHAIN = (function () {
//   const { BLOCKCHAIN='bitcoin:testnet' } = env
//   const [blockchain, networkName] = BLOCKCHAIN.split(':')
//   return {
//     blockchain,
//     networkName,
//     toString: () => BLOCKCHAIN,
//     select: obj => obj[blockchain]
//   }
// }())

// env.DEV = env.SERVERLESS_STAGE === 'dev'

// for (let prop in process.env) {
//   if (prop.slice(0, 3) === 'CF_') {
//     let split = splitCamelCase(prop.slice(3), '_').toUpperCase()
//     env[split] = process.env[prop]
//   }
// }

const lazy = require('./lazy')
const ENV = require('./env')
const {
  FAUCET_PRIVATE_KEY,
  BLOCKCHAIN
} = require('./env')

const { toCamelCase, splitCamelCase } = require('./string-utils')
const cachifiable = {
  ObjectsBucket: true
}

function Environment () {
  const self = this

  this.require = lazy(require, this)

  this.aws = this.require('aws', './aws')
  this.networks = this.require('networks', './networks')

  let network
  this.__defineGetter__('network', function () {
    if (!network) {
      network = self.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName]
    }

    return network
  })

  let blockchain
  this.__defineGetter__('blockchain', function () {
    if (blockchain) return blockchain

    const createBlockchainAPI = require('./blockchain')
    return blockchain = createBlockchainAPI(BLOCKCHAIN)
  })

  let seals
  this.__defineGetter__('seals', function () {
    if (!seals) {
      seals = require('./seals')({
        table: self.tables.SealsTable,
        blockchain: self.blockchain,
        confirmationsRequired: ENV.SEAL_CONFIRMATIONS[ENV.BLOCKCHAIN]
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
  this.constants = this.require('constants', './constants')
  this.errors = this.require('errors', './errors')
  this.utils = this.require('utils', './utils')
  this.dbUtils = this.require('dbUtils', './db-utils')
  this.s3Utils = this.require('s3Utils', './s3-utils')
  // this.env = {}
  this.tables = this.require('tables', './tables')
  this.buckets = this.require('buckets', './buckets')
  // this.provider = this.require('provider', './provider')
}

exports = module.exports = new Environment()
exports.new = () => new Environment()
