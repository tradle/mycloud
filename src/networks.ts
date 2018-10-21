import matches from 'lodash/matches'
import getProp from 'lodash/get'
import { BlockchainNetwork, BlockchainNetworkInfo } from './types'

const curve = 'secp256k1'
const constants:BlockchainNetworkInfo[] = [
  {
    blockchain: 'bitcoin',
    networkName: 'testnet',
    minBalance: 1000000,
    confirmations: 6
  },
  // bitcoinjs-lib's name for it
  {
    blockchain: 'bitcoin',
    networkName: 'bitcoin',
    minBalance: 1000000,
    confirmations: 6
  },
  {
    blockchain: 'ethereum',
    networkName: 'mainnet',
    minBalance: '10000000000000000',
    confirmations: 20
  },
  {
    blockchain: 'ethereum',
    networkName: 'ropsten',
    minBalance: '10000000000000000',
    confirmations: 20
  },
  {
    blockchain: 'ethereum',
    networkName: 'rinkeby',
    minBalance: '10000000000000000',
    confirmations: 20
  },
  {
    blockchain: 'corda',
    networkName: 'private',
    confirmations: 0
  }
]

interface BlockchainNetworkMap {
  [networkName: string]: BlockchainNetwork
}

interface BlockchainMap {
  [blockchain: string]: BlockchainNetworkMap
}

const networks:BlockchainMap = {}

const getAdapter = name => {
  const adapters = require('./blockchain-adapter').default
  return adapters[name]
}

const getNetwork = ({ blockchain, networkName }):BlockchainNetwork => {
  let readOnlyAdapter
  const getReadOnlyAdapter = (opts:any={}) => {
    if (!readOnlyAdapter) {
      readOnlyAdapter = getAdapter(blockchain)({
        ...opts,
        networkName
      })
    }

    return readOnlyAdapter
  }

  const info = constants.find(matches({ blockchain, networkName })) || {}
  return {
    ...info,
    blockchain,
    networkName,
    curve,
    get pubKeyToAddress() {
      const { network } = getReadOnlyAdapter()
      return network && network.pubKeyToAddress
    },
    transactor(privateKey) {
      return getAdapter(blockchain)({ networkName, privateKey }).transactor
    },
    toString: () => `${blockchain}:${networkName}`,
    // select: obj => obj[blockchain]
  }
}

constants.forEach(info => {
  const { blockchain, networkName } = info
  if (!networks[blockchain]) networks[blockchain] = {}

  const sub = networks[blockchain]
  let cached
  Object.defineProperty(sub, networkName, {
    enumerable: true,
    get() {
      if (!cached) {
        cached = getNetwork({ blockchain, networkName })
      }

      return cached
    }
  })
})

export = networks
