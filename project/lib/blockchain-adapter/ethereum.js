
const Wallet = require('ethereumjs-wallet')
const Network = require('@tradle/ethereum-adapter')

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
    pollingInterval: 20000,
    etherscan: true,
    autostart: false
  })

  if (wallet) {
    transactor = Network.createTransactor({ network, wallet, engine })
  }

  const blockchain = Network.createBlockchainAPI({ engine })
  return {
    network,
    blockchain,
    transactor
  }
}
