
import extend = require('xtend/mutable')
import adapters from './blockchain-adapter'
const curve = 'secp256k1'
const networks = module.exports = {
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
    // ropsten: {
    //   minBalance: '2000000000000000000',
    //   confirmations: 12
    // },
    rinkeby: {
      minBalance: '2000000000000000000',
      confirmations: 12
    }
  }
}

Object.keys(networks).forEach(flavor => {
  Object.keys(networks[flavor]).forEach(networkName => {
    let readOnlyAdapter
    extend(networks[flavor][networkName], {
      flavor,
      networkName,
      curve,
      get constants () {
        if (!readOnlyAdapter) {
          readOnlyAdapter = getReadOnlyAdapter()
        }

        return readOnlyAdapter.constants
      },
      readOnlyAdapter: getReadOnlyAdapter,
      transactor: function (privateKey) {
        return adapters[flavor]({ networkName, privateKey }).transactor
      },
      toString: () => `${flavor}:${networkName}`,
      select: obj => obj[flavor]
    })

    function getReadOnlyAdapter (opts={}) {
      if (!readOnlyAdapter) {
        opts.networkName = networkName
        readOnlyAdapter = adapters[flavor](opts)
      }

      return readOnlyAdapter
    }
  })
})
