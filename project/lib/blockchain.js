const debug = require('debug')('tradle:sls:blockchain')
const { utils, protocol } = require('@tradle/engine')
const { co, promisify, typeforce } = require('./utils')
const { prettify } = require('./string-utils')
// const { BLOCKCHAIN } = require('./env')
const adapters = require('./blockchain-adapter')
const ENV = require('./env')

function createWrapper (blockchainIdentifier) {
  typeforce({
    flavor: typeforce.String,
    networkName: typeforce.String
  }, blockchainIdentifier)

  const createAdapter = adapters[blockchainIdentifier.flavor]
  if (!createAdapter) {
    throw new Error(`unsupported blockchain type: ${blockchainIdentifier.flavor}`)
  }

  const { networkName } = blockchainIdentifier
  const reader = createAdapter({ networkName })
  const Addresses = promisify(reader.blockchain.addresses)
  const getInfo = promisify(reader.blockchain.info)

  const { network } = reader
  const writerCache = {}

  const getWriter = function getWriter (key) {
    const { pub, priv } = key
    if (!writerCache[pub]) {
      const { transactor } = createAdapter({
        networkName,
        privateKey: priv
      })

      writerCache[pub] = promisify(transactor)
    }

    return writerCache[pub]
  }

  const getBlockHeight = co(function* () {
    const { blockHeight } = yield getInfo()
    return blockHeight
  })

  const getTransactionsForAddresses = co(function* (addresses, blockHeight) {
    if (typeof blockHeight !== 'number') {
      blockHeight = yield getBlockHeight()
    }

    const txInfos = yield Addresses.transactions(addresses, blockHeight)
    txInfos.forEach(info => {
      if (!info.confirmations && typeof info.blockHeight === 'number') {
        info.confirmations = blockHeight - info.blockHeight
      }
    })

    debug(`fetched transactions for addresses: ${addresses.join(', ')}: ${prettify(txInfos)}`)
    return txInfos
  })

  // const sync = co(function* (addresses) {
  //   return getTransactionsForAddresses(addresses)
  // })

  const seal = co(function* ({ key, link, addresses }) {
    const writer = getWriter(key)
    return yield writer.send({
      to: addresses.map(address => {
        return {
          address,
          amount: getTransactionAmount()
        }
      })
    })
  })

  const getTransactionAmount = function getTransactionAmount () {
    return network.minOutputAmount
  }

  const sealPubKey = function sealPubKey ({ link, basePubKey }) {
    link = utils.linkToBuf(link)
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPubKey({ link, basePubKey })
  }

  const sealPrevPubKey = function sealPrevPubKey ({ link, basePubKey }) {
    link = utils.linkToBuf(link)
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPrevPubKey({ link, basePubKey })
  }

  const sealAddress = function sealAddress ({ link, basePubKey }) {
    const { pub } = sealPubKey({ link, basePubKey })
    return network.pubKeyToAddress(pub)
  }

  const sealPrevAddress = function sealPrevAddress ({ link, basePubKey }) {
    const { pub } = sealPrevPubKey({ link, basePubKey })
    return network.pubKeyToAddress(pub)
  }

  return {
    pubKeyToAddress: network.pubKeyToAddress,
    networkName: network.name,
    flavor: network.blockchain,
    // sync,
    seal,
    getTransactionsForAddresses,
    sealPubKey,
    sealPrevPubKey,
    sealAddress,
    sealPrevAddress,
    toString: () => `${network.blockchain}:${network.name}`,
    _adapter: reader
  }
}

exports = module.exports = createWrapper

// module.exports = createWrapper(ENV.BLOCKCHAIN)
