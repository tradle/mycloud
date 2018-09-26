import Blockr from '@tradle/cb-blockr'
import Networks from '@tradle/bitcoin-adapter'

export = function getNetworkAdapters ({ networkName, privateKey, proxy }) {
  const network = Networks[networkName]
  const blockchain = network.wrapCommonBlockchain(new Blockr(networkName, proxy))
  const transactor = privateKey && network.createTransactor({ privateKey, blockchain })
  return {
    network,
    blockchain,
    transactor
  }
}
