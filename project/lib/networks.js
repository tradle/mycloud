
const extend = require('xtend/mutable')
const adapters = require('./blockchain-adapter')
const networks = module.exports = {
  bitcoin: {
    testnet: {
      minBalance: 1000000
    },
    // bitcoinjs-lib's name for it
    bitcoin: {
      minBalance: 1000000
    }
  },
  ethereum: {
    ropsten: {
      minBalance: '2000000000000000000'
    },
    rinkeby: {
      minBalance: '2000000000000000000'
    }
  }
}

Object.keys(networks).forEach(flavor => {
  Object.keys(networks[flavor]).forEach(networkName => {
    let readOnlyAdapter
    extend(networks[flavor][networkName], {
      flavor,
      networkName,
      get constants () {
        return getReadOnlyAdapter().constants
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
