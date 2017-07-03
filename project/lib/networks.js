
const adapters = require('./blockchain-adapter')
const networks = module.exports = {
  bitcoin: {
    testnet: {},
    bitcoin: {}
  },
  ethereum: {
    ropsten: {}
  }
}

Object.keys(networks).forEach(flavor => {
  Object.keys(networks[flavor]).forEach(networkName => {
    let readOnlyAdapter
    networks[flavor][networkName] = {
      flavor,
      networkName,
      get constants () {
        return getReadOnlyAdapter().constants
      },
      readOnlyAdapter: getReadOnlyAdapter,
      transactor: function (privateKey) {
        return adapters[flavor]({ networkName, privateKey }).transactor
      },
      toString: () => `${flavor}:${networkName}`
    }

    function getReadOnlyAdapter (opts) {
      if (!readOnlyAdapter) {
        opts.networkName = networkName
        readOnlyAdapter = adapters[flavor](opts)
      }

      return readOnlyAdapter
    }
  })
})
