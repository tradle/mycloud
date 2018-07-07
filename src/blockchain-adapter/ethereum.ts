
import Wallet from 'ethereumjs-wallet'
import BN from 'bn.js'
import promisify from 'pify'
import fetch from 'node-fetch'
import Network from '@tradle/ethereum-adapter'
import { processResponse } from '../utils'

const debug = require('debug')('tradle:sls:ethereum-adapter')
const FAUCET_BASE_URL = 'http://faucet.ropsten.be:3001/donate'

export = function getNetworkAdapters ({ networkName='ropsten', privateKey }) {
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
      etherscan: true,
      autostart: false
    }
  })

  if (wallet) {
    transactor = network.createTransactor({ wallet })
  }

  const blockchain = network.createBlockchainAPI()
  const getBalance = promisify(blockchain.addresses.balance)
  const recharge = async ({ address, minBalance, force }) => {
    const minBalanceBN = minBalance.startsWith('0x')
      ? new BN(minBalance.slice(2), 16)
      : new BN(minBalance)

    if (!force) {
      let balance
      blockchain.start()
      try {
        balance = await getBalance(address)
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

    const res = await fetch(`${FAUCET_BASE_URL}/${address}`)
    return await processResponse(res)
  }

  return {
    network,
    blockchain,
    transactor,
    recharge
  }
}
