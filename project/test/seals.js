process.env.IS_LOCAL = true
// const AWS = require('aws-sdk')
const test = require('tape')
const utils = require('../lib/utils')
const co = utils.loudCo
const { wait } = utils
const { getTable, batchPut } = require('../lib/db-utils')
const schema = require('../conf/seals-table-schema')
const aws = require('../lib/aws')
const createBlockchainAPI = require('../lib/blockchain')
const createSealsAPI = require('../lib/seals')
const aliceKeys = require('./fixtures/alice/keys')
const adapters = require('../lib/blockchain-adapter')
const flavor = 'bitcoin'
const networkName = 'testnet'

test('queue seal', co(function* (t) {
  const table = yield recreateTable(schema)
  // adapters.bitcoin = function ({ networkName, privateKey, proxy }) {
  //   return {
  //     transactor: {
  //       send: function (opts, cb) {
  //         t.equal(opts.to[0].address, addressd)
  //         t.ok('transacted')
  //         cb()
  //       }
  //     }
  //   }
  // }

  const txId = 'sometxid'
  const blockchain = createBlockchainAPI({ flavor, networkName })

  let sealed
  blockchain.seal = function (sealInfo) {
    t.equal(sealInfo.address, address)
    sealed = true
    return Promise.resolve({ txId })
  }

  blockchain.getTransactionsForAddresses = function (addresses, blockHeight) {
    return Promise.resolve([
      {
        txId,
        confirmations: 10000
      }
    ])
  }

  const seals = createSealsAPI({ blockchain, table })

  const key = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
  const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'
  const address = blockchain.sealAddress({
    link,
    basePubKey: key
  })

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

  t.end()
}))

const recreateTable = co(function* (schema) {
  const table = getTable(schema.TableName)
  try {
    yield table.destroy()
  } catch (err) {}

  yield table.create(schema)
  return table
})
