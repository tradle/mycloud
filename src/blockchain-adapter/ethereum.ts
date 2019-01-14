
import Wallet from 'ethereumjs-wallet'
import BN from 'bn.js'
import fetch from 'node-fetch'
import Network from '@tradle/ethereum-adapter'
import { get } from '../utils'
import Errors from '../errors'

const debug = require('debug')('tradle:sls:ethereum-adapter')
const FAUCET_BASE_URL = 'http://faucet.ropsten.be:3001/donate'
// const GWEI = 1000000000
// const GAS_LIMIT = 21000
// MAX_PRICE_IN_WEI is 15 * GWEI * GAS_LIMIT
const MAX_PRICE_IN_WEI = new BN('315000000000000', 10)

export = function getNetworkAdapters ({ networkName, privateKey }) {
  if (!networkName) {
    throw new Errors.InvalidInput('expected string "networkName"')
  }

  let wallet
  let transactor
  if (privateKey) {
    privateKey = new Buffer(privateKey, 'hex')
    wallet = Wallet.fromPrivateKey(privateKey)
  }

  const network = Network.createNetwork({
    networkName,
    engineOpts: {
      networkName,
      privateKey,
      pollingInterval: 10000,
      etherscan: {
        maxRequestsPerSecond: 5,
      },
      autostart: false,
      maxPriceInWei: MAX_PRICE_IN_WEI,
    }
  })

  if (wallet) {
    transactor = network.createTransactor({ wallet })
  }

  const blockchain = network.createBlockchainAPI()
  const recharge = async ({ address, minBalance, force }) => {
    const minBalanceBN = minBalance.startsWith('0x')
      ? new BN(minBalance.slice(2), 16)
      : new BN(minBalance)

    if (!force) {
      let balance
      blockchain.start()
      try {
        balance = await blockchain.addresses.balance(address)
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

    return await get(`${FAUCET_BASE_URL}/${address}`)
  }

  return {
    network,
    blockchain,
    transactor,
    recharge
  }
}
