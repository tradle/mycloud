require('./env')

// const AWS = require('aws-sdk')
const test = require('tape')
const sinon = require('sinon')
const utils = require('../lib/utils')
const co = utils.loudCo
const { wait } = utils
const { getTable, batchPut } = require('../lib/db-utils')
const aws = require('../lib/aws')
// const createBlockchainAPI = require('../lib/blockchain')
// const createSealsAPI = require('../lib/seals')
const aliceKeys = require('./fixtures/alice/keys')
const adapters = require('../lib/blockchain-adapter')
const { recreateTable } = require('./utils')
const SealsTableLogicalId = 'SealsTable'
const createTradle = require('../').new

const blockchainOpts = {
  flavor: 'ethereum',
  networkName: 'rinkeby'
}

test('queue seal', co(function* (t) {
  const { flavor, networkName } = blockchainOpts
  const table = yield recreateTable(SealsTableLogicalId)
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
  const stubSeal = sinon.stub(blockchain, 'seal')
    .callsFake(co(function* (sealInfo) {
      t.same(sealInfo.addresses, [address])
      sealed = true
      return { txId }
    }))

  const stubGetTxs = sinon.stub(blockchain, 'getTxsForAddresses')
    .callsFake(function (addresses, blockHeight) {
      return Promise.resolve([
        {
          txId,
          confirmations: 10000,
          to: {
            addresses: [address]
          }
        }
      ])
    })

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

  yield seals.sealPending()
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

  stubSeal.restore()
  stubGetTxs.restore()
  t.end()
}))
