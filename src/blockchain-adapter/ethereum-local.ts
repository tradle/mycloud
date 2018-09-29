import Adapter from '@tradle/blockchain-indexer-client'
import fallback from './ethereum'

export = function getNetworkAdapters(opts) {
  let {
    address,
    privateKey,
    apiUrl,
    apiKey,
    networkName,
  } = opts

  if (!apiUrl) {
    // tslint:disable-next-line: no-console
    console.warn('missing api url, falling back to hosted api')
    return fallback(opts)
  }

  let transactor
  if (privateKey) {
    privateKey = new Buffer(privateKey, 'hex')
  }

  const network = Adapter.forNetwork({ networkName, baseUrl: apiUrl, apiKey })
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
