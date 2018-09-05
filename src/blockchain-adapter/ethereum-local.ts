import Adapter from '@tradle/blockchain-indexer-client'

export = function getNetworkAdapters({
  address,
  privateKey,
  baseUrl,
  networkName = 'ropsten',
  apiKey='blah',
}) {
  if (!baseUrl) {
    baseUrl = `http://parity-ropsten-2-764848607.us-east-1.elb.amazonaws.com/eth/v1/ropsten`
  }

  let transactor
  if (privateKey) {
    privateKey = new Buffer(privateKey, 'hex')
  }

  const network = Adapter.forNetwork({ networkName, baseUrl, apiKey })
  if (privateKey) {
    transactor = network.createTransactor({ address, privateKey })
  }

  const blockchain = network.api
  return {
    network,
    blockchain,
    transactor,
  }
}
