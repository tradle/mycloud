const nock = require('nock')

require('./env').install()

// const AWS = require('aws-sdk')
const test = require('tape')
const sinon = require('sinon')
const { TYPE } = require('@tradle/constants')
const utils = require('../utils')
const crypto = require('../crypto')
const co = utils.loudCo
const { wait, deepClone } = utils
const aliceKeys = require('./fixtures/alice/keys')
const adapters = require('../blockchain-adapter')
const { recreateTable } = require('./utils')
const SealsTableLogicalId = 'SealsTable'
const { Tradle } = require('../')
const sealedObj = deepClone(require('./fixtures/bob/identity'))
crypto.addLinks(sealedObj)

const blockchainOpts = {
  flavor: 'ethereum',
  networkName: 'rinkeby'
}

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

test('queue seal', co(function* (t) {
  const { flavor, networkName } = blockchainOpts
  const table = yield recreateTable(SealsTableLogicalId)
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


  const stubObjectsGet = sinon.stub(tradle.objects, 'get')
    .callsFake(co(function* (_link) {
      if (_link === link) {
        return sealedObj
      }

      throw new Error('NotFound')
    }))

  const stubObjectsPut = sinon.stub(tradle.objects, 'put')
    .callsFake(co(function* (object) {
      t.equal(object._seal.link, sealedObj._link)
      t.equal(object._seal.txId, txId)
    }))

  const stubDBUpdate = sinon.stub(tradle.db, 'update')
    .callsFake(co(function* (props) {
      t.equal(props[TYPE], sealedObj[TYPE])
      t.equal(props._permalink, sealedObj._permalink)
      t.equal(props._seal.link, sealedObj._link)
      t.equal(props._seal.txId, txId)
    }))

  yield seals.create({ key, link, permalink })
  let unconfirmed = yield seals.getUnconfirmed()
  t.equal(unconfirmed.length, 0)

  let unsealed = yield seals.getUnsealed()
  t.equal(unsealed.length, 1)
  t.equal(unsealed[0].address, address)

  yield seals.sealPending()
  unsealed = yield seals.getUnsealed()
  t.equal(unsealed.length, 0)

  yield seals.syncUnconfirmed()
  unconfirmed = yield seals.getUnconfirmed()
  t.equal(unconfirmed.length, 0)

  const seal = yield seals.get({ link })
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
}))
