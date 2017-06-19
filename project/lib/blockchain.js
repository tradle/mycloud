const { utils, protocol } = require('@tradle/engine')
const { sealPubKey, sealPrevPubKey } = utils
const { co, promisify } = require('./utils')
// const { BLOCKCHAIN } = require('./env')
const adapters = require('./blockchain-adapter')

module.exports = function createWrapper (blockchainIdentifier) {
  typeforce({
    type: typeforce.String,
    name: typeforce.String
  }, blockchainIdentifier)

  const createAdapter = adapters[blockchainIdentifier.type]
  if (!createAdapter) {
    throw new Error(`unsupported blockchain type: ${type}`)
  }

  const networkName = blockchainIdentifier.name
  const reader = createAdapter({ networkName })
  reader.addresses = promisify(reader.addresses)
  const { network } = reader
  const writerCache = {}

  const getWriter = function getWriter ({ pub }) {
    if (!writerCache[pub]) {
      const { transactor } = createAdapter({
        networkName,
        privateKey: priv
      })

      writerCache[pub] = promisify(transactor)
    }

    return writerCache[pub]
  }

  const getTransactionsForAddresses = co(function* (addresses) {
    const txInfos = yield reader.addresses.transactions(addresses)
    txInfos.forEach(info => {
      if (!info.confirmations && typeof info.blockHeight === 'number') {
        info.confirmations = blockHeight - info.blockHeight
      }
    })

    return txInfos
  })

  // const sync = co(function* (addresses) {
  //   return getTransactionsForAddresses(addresses)
  // })

  const seal = co(function* ({ key, link, addresses }) {
    const writer = getWriter(key)
    yield writer.send({
      to: addresses.map(address => {
        return {
          address,
          amount: getTransactionAmount()
        }
      })
    })
  })

  const pubKeyToAddress = function pubKeyToAddress () {
    return getReader().pubKeyToAddress
  }

  const getTransactionAmount = function getTransactionAmount () {
    return network.minOutputAmount
  }

  return {
    // sync,
    seal,
    getTransactionsForAddresses,
    pubKeyToAddress: network.pubKeyToAddress,
    name: network.name,
    type: network.type,
    sealPubKey,
    sealPrevPubKey
  }
}
