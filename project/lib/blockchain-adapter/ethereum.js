
const debug = require('debug')('tradle:sls:ethereum-adapter')
const co = require('co').wrap
const Wallet = require('ethereumjs-wallet')
const request = require('superagent')
const BN = require('bn.js')
const promisify = require('pify')
const Network = require('@tradle/ethereum-adapter')
const FAUCET_BASE_URL = 'http://faucet.ropsten.be:3001/donate'

module.exports = function getNetworkAdapters ({ networkName='ropsten', privateKey }) {
  let wallet
  let transactor
  if (privateKey) {
    privateKey = new Buffer(privateKey, 'hex')
    wallet = Wallet.fromPrivateKey(privateKey)
  }

  const network = Network.createNetwork({ networkName })
  const engine = Network.createEngine({
    networkName,
    privateKey,
    pollingInterval: 10000,
    etherscan: true,
    autostart: false
  })

  if (wallet) {
    transactor = Network.createTransactor({ network, wallet, engine })
  }

  const blockchain = Network.createBlockchainAPI({ engine })
  const getBalance = promisify(blockchain.addresses.balance)
  const recharge = co(function* ({ address, minBalance, force }) {
    const minBalanceBN = minBalance.startsWith('0x')
      ? new BN(minBalance.slice(2), 16)
      : new BN(minBalance)

    if (!force) {
      let balance
      blockchain.start()
      try {
        balance = yield getBalance(address)
        debug(`current balance: ${balance}, min balance: ${minBalance}`)
      } finally {
        blockchain.stop()
      }

      if (new BN(balance).cmp(minBalanceBN) === 1) {
        debug('min balance achieved, not recharging')
        return {
          balance
        }
      }
    }

    debug(`recharging ${address} from faucet at ${FAUCET_BASE_URL}`)

    const res = yield request(`${FAUCET_BASE_URL}/${address}`)
    const { ok, body, text } = res
    if (!ok) {
      throw new Error(text)
    }

    return body
  })

  return {
    network,
    blockchain,
    transactor,
    recharge
  }
}
