const nock = require('nock')

require('./env').install()

// const AWS = require('aws-sdk')
import test = require('tape')
import sinon = require('sinon')
import { TYPE } from '@tradle/constants'
import { wait, deepClone } from '../utils'
import { addLinks } from '../crypto'
import adapters from '../blockchain-adapter'
import { recreateTable } from './utils'
import Tradle from '../tradle'
import Errors = require('../errors')
const aliceKeys = require('./fixtures/alice/keys')
const bobKeys = require('./fixtures/bob/keys')
const aliceIdentity = require('./fixtures/alice/identity')
const bobIdentity = require('./fixtures/bob/identity')
addLinks(aliceIdentity)
addLinks(bobIdentity)
const blockchainOpts = {
  flavor: 'ethereum',
  networkName: 'rinkeby'
}

const SealsTableLogicalId = 'SealsTable'
const rejectEtherscanCalls = () => {
  nock('http://rinkeby.etherscan.io/')
    .get(uri => uri.startsWith('/api'))
    .reply(function () {
      rejectEtherscanCalls()
      return {
        statusCode: 403,
        body: '403 - Forbidden: Access is denied.'
      }
    })
}

rejectEtherscanCalls()

test('handle failed reads/writes', async (t) => {
  const { flavor, networkName } = blockchainOpts
  const table = await recreateTable(SealsTableLogicalId)
  const txId = 'sometxid'
  const tradle = new Tradle()
  const { blockchain, seals } = tradle
  const aliceKey = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
  const bobKey = bobKeys.find(key => key.type === flavor && key.networkName === networkName)
  const stubGetTxs = sinon.stub(blockchain, 'getTxsForAddresses').resolves([])

  await seals.create({ key: aliceKey, link: aliceIdentity._link })
  await seals.watch({ key: bobKey, link: bobIdentity._link })

  let unconfirmed = await seals.getUnconfirmed()
  t.equal(unconfirmed.length, 1)

  let failedReads = await seals.getFailedReads({ gracePeriod: 1 }) // 1ms
  t.equal(failedReads.length, 1)

  const stubSeal = sinon.stub(seals.blockchain, 'seal').resolves({ txId: 'sometxid' })
  await seals.sealPending()

  let failedWrites = await seals.getFailedWrites({ gracePeriod: 1 }) // 1ms
  t.equal(failedWrites.length, 1)

  let longUnconfirmed = await seals.getLongUnconfirmed({ gracePeriod: 1 }) // 1ms
  t.equal(longUnconfirmed.length, 2)

  const spyBatchPut = sinon.spy(seals.table, 'batchPut')
  await seals.handleFailures({ gracePeriod: 1 })

  t.equal(spyBatchPut.callCount, 2)
  spyBatchPut.getCalls().forEach(({ args }) => {
    const [expired] = args
    t.equal(expired.length, 1)
    if (expired[0].link === failedReads[0].link) {
      t.ok(expired[0].unwatched)
    } else {
      t.same(expired[0].link, failedWrites[0].link)
      t.ok(expired[0].unsealed)
    }
  })

  let unsealed = await seals.getUnsealed()
  t.equal(unsealed.length, 1)

  t.equal(stubSeal.callCount, 1)
  await seals.sealPending()

  t.equal(stubSeal.callCount, 2)

  t.end()
})

test('queue seal', async (t) => {
  const { flavor, networkName } = blockchainOpts
  const table = await recreateTable(SealsTableLogicalId)
  const sealedObj = aliceIdentity
  const link = sealedObj._link
  const permalink = sealedObj._permalink
  const txId = 'sometxid'
  // const blockchain = createBlockchainAPI({ flavor, networkName })
  const tradle = new Tradle()
  const { blockchain, seals } = tradle
  const key = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
  const address = blockchain.sealAddress({
    link,
    basePubKey: key
  })

  let sealed
  const stubSeal = sinon.stub(blockchain, 'seal')
    .callsFake(async (sealInfo) => {
      t.same(sealInfo.addresses, [address])
      sealed = true
      return { txId }
    })

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

  const stubObjectsGet = sinon.stub(tradle.objects, 'get')
    .callsFake(async (_link) => {
      if (_link === link) {
        return sealedObj
      }

      throw new Error('NotFound')
    })

  const stubObjectsPut = sinon.stub(tradle.objects, 'put')
    .callsFake(async (object) => {
      t.equal(object._seal.link, link)
      t.equal(object._seal.txId, txId)
    })

  const stubDBUpdate = sinon.stub(tradle.db, 'update')
    .callsFake(async (props) => {
      t.equal(props[TYPE], sealedObj[TYPE])
      t.equal(props._permalink, permalink)
      t.equal(props._seal.link, link)
      t.equal(props._seal.txId, txId)
    })

  const stubDBGet = sinon.stub(tradle.db, 'get')
    .callsFake(async (props) => {
      if (props._permalink === permalink) {
        return sealedObj
      }

      throw new Errors.NotFound(permalink)
    })

  await seals.create({ key, link, permalink })
  let unconfirmed = await seals.getUnconfirmed()
  t.equal(unconfirmed.length, 0)

  let unsealed = await seals.getUnsealed()
  t.equal(unsealed.length, 1)
  t.equal(unsealed[0].address, address)

  await seals.sealPending()
  unsealed = await seals.getUnsealed()
  t.equal(unsealed.length, 0)

  unconfirmed = await seals.getUnconfirmed()
  t.equal(unconfirmed.length, 1)

  let longUnconfirmed = await seals.getLongUnconfirmed({ gracePeriod: 1 }) // 1ms
  t.equal(longUnconfirmed.length, 1)

  longUnconfirmed = await seals.getLongUnconfirmed({ gracePeriod: 1000 }) // 1s
  t.equal(longUnconfirmed.length, 0)

  await seals.syncUnconfirmed()
  unconfirmed = await seals.getUnconfirmed()
  t.equal(unconfirmed.length, 0)

  t.same(await seals.getLongUnconfirmed(), [])

  const seal = await seals.get({ link })
  t.equal(seal.address, address)
  t.equal(seal.link, link)

  t.equal(stubObjectsGet.callCount, 1)
  t.equal(stubObjectsPut.callCount, 1)
  t.equal(stubDBUpdate.callCount, 1)

  stubSeal.restore()
  stubGetTxs.restore()
  stubObjectsGet.restore()
  stubDBUpdate.restore()
  t.end()
})
