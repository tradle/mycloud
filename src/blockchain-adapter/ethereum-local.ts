import Network from '@tradle/blockchain-indexer-client'

export = function getNetworkAdapters({
  address,
  privateKey,
  networkName = 'ropsten',
  baseUrl,
}) {
  if (!baseUrl) {
    baseUrl = `http://localhost:9898/${networkName}`
  }

  let transactor
  if (privateKey) {
    privateKey = new Buffer(privateKey, 'hex')
  }

  const network = Network.createNetwork({ networkName, baseUrl })
  if (privateKey) {
    transactor = network.createTransactor({ address, privateKey })
  }

  const blockchain = network.createBlockchainAPI()
  return {
    network,
    blockchain,
    transactor,
  }
}
