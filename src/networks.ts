
import getProp from 'lodash/get'

const curve = 'secp256k1'
const constants = {
  bitcoin: {
    testnet: {
      minBalance: 1000000,
      confirmations: 6
    },
    // bitcoinjs-lib's name for it
    bitcoin: {
      minBalance: 1000000,
      confirmations: 6
    }
  },
  ethereum: {
    mainnet: {
      minBalance: '2000000000000000000',
      confirmations: 12
    },
    ropsten: {
      minBalance: '2000000000000000000',
      confirmations: 12
    },
    rinkeby: {
      minBalance: '2000000000000000000',
      confirmations: 12
    }
  },
  corda: {
    private: {
      confirmations: 0
    }
  }
}

const networks = {}

const getAdapter = name => {
  const adapters = require('./blockchain-adapter').default
  return adapters[name]
}

const getNetwork = ({ flavor, networkName }) => {
  let readOnlyAdapter
  const getReadOnlyAdapter = (opts:any={}) => {
    if (!readOnlyAdapter) {
      readOnlyAdapter = getAdapter(flavor)({
        ...opts,
        networkName
      })
    }

    return readOnlyAdapter
  }

  return {
    ...getProp(constants, [flavor, networkName], {}),
    flavor,
    networkName,
    curve,
    get pubKeyToAddress() {
      const { network } = getReadOnlyAdapter()
      return network && network.pubKeyToAddress
    },
    transactor: function(privateKey) {
      return getAdapter(flavor)({ networkName, privateKey }).transactor
    },
    toString: () => `${flavor}:${networkName}`,
    select: obj => obj[flavor]
  }
}

Object.keys(constants).forEach(flavor => {
  const sub = networks[flavor] = {}
  Object.keys(constants[flavor]).forEach(networkName => {
    let cached
    Object.defineProperty(sub, networkName, {
      enumerable: true,
      get() {
        if (!cached) {
          cached = getNetwork({ flavor, networkName })
        }

        return cached
      }
    })
  })
})

export = networks
