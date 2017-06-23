require('./env')

// const AWS = require('aws-sdk')
const test = require('tape')
const utils = require('../lib/utils')
const co = utils.loudCo
const { wait } = utils
const { getTable, batchPut } = require('../lib/db-utils')
const schema = require('../conf/table/seals').Properties
schema.StreamSpecification.StreamEnabled = true

const aws = require('../lib/aws')
// const createBlockchainAPI = require('../lib/blockchain')
// const createSealsAPI = require('../lib/seals')
const aliceKeys = require('./fixtures/alice/keys')
const adapters = require('../lib/blockchain-adapter')
const { recreateTable } = require('./utils')
const createTradle = require('../').new

const blockchainOpts = {
  flavor: 'bitcoin',
  networkName: 'testnet'
}

test('queue seal', co(function* (t) {
  const { flavor, networkName } = blockchainOpts
  const table = yield recreateTable(schema)
  const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'
  const txId = 'sometxid'
  // const blockchain = createBlockchainAPI({ flavor, networkName })
  const tradle = createTradle()
  const { blockchain, seals } = tradle
  const key = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
  const address = blockchain.sealAddress({
    link,
    basePubKey: key
  })

  let sealed
  blockchain.seal = function (sealInfo) {
    t.same(sealInfo.addresses, [address])
    sealed = true
    return Promise.resolve({ txId })
  }

  blockchain.getTransactionsForAddresses = function (addresses, blockHeight) {
    return Promise.resolve([
      {
        txId,
        confirmations: 10000,
        to: {
          addresses: [address]
        }
      }
    ])
  }

  // let read
  // let wrote
  // const onread = function (seal) {
  //   read = true
  //   t.equal(seal.address, address)
  //   t.equal(seal.txId, txId)
  // }

  // const onwrote = function (seal) {
  //   wrote = true
  //   t.equal(seal.address, address)
  //   t.equal(seal.txId, txId)
  // }

  // const seals = createSealsAPI({ blockchain, table /*, onread, onwrote*/ })
  yield seals.create({ key, link })
  let unconfirmed = yield seals.getUnconfirmed()
  t.equal(unconfirmed.length, 1)
  t.equal(unconfirmed[0].address, address)

  let unsealed = yield seals.getUnsealed()
  t.same(unsealed, unconfirmed)

  yield seals.sealPending({ key })
  unsealed = yield seals.getUnsealed()
  t.equal(unsealed.length, 0)

  yield seals.syncUnconfirmed()
  unconfirmed = yield seals.getUnconfirmed()
  t.equal(unconfirmed.length, 0)

  const seal = yield seals.get({ link })
  t.equal(seal.address, address)
  t.equal(seal.link, link)

  // t.equal(read, true)
  // t.equal(wrote, true)

  t.end()
}))
