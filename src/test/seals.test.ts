const nock = require('nock')

require('./env').install()

// const AWS = require('aws-sdk')
import QS from 'querystring'
import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
import { TYPE, SIG } from '@tradle/constants'
import { wait, deepClone } from '../utils'
import { addLinks } from '../crypto'
import adapters from '../blockchain-adapter'
import { recreateTable } from './utils'
import Tradle from '../tradle'
import { Env } from '../env'
import Errors from '../errors'
import { loudAsync } from '../utils'
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

test('handle failed reads/writes', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const { flavor, networkName } = blockchainOpts
  const env = new Env(process.env)
  env.BLOCKCHAIN = blockchainOpts

  const tradle = new Tradle(env)
  const table = await recreateTable(SealsTableLogicalId)
  const txId = 'sometxid'

  const { blockchain, seals } = tradle
  const aliceKey = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
  const bobKey = bobKeys.find(key => key.type === flavor && key.networkName === networkName)
  const stubGetTxs = sandbox.stub(blockchain, 'getTxsForAddresses').resolves([])

  await seals.create({ key: aliceKey, link: aliceIdentity._link })
  await seals.watch({ key: bobKey, link: bobIdentity._link })

  let unconfirmed = await seals.getUnconfirmed()
  t.equal(unconfirmed.length, 1)

  let failedReads = await seals.getFailedReads({ gracePeriod: 1 }) // 1ms
  t.equal(failedReads.length, 1)

  const stubSeal = sandbox.stub(seals.blockchain, 'seal').resolves({ txId: 'sometxid' })
  const stubBalance = sandbox.stub(seals.blockchain, 'balance').resolves('aabbccddeeff')
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
  sandbox.restore()
  t.end()
}))

test('queue seal', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const clock = sinon.useFakeTimers()
  const env = new Env(process.env)
  env.BLOCKCHAIN = blockchainOpts

  const tradle = new Tradle(env)
  const { flavor, networkName } = blockchainOpts
  const table = await recreateTable(SealsTableLogicalId)
  const sealedObj = aliceIdentity
  const link = sealedObj._link
  const permalink = sealedObj._permalink
  const txId = 'sometxid'
  // const blockchain = createBlockchainAPI({ flavor, networkName })
  const { blockchain, seals } = tradle
  const key = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
  const address = blockchain.sealAddress({
    link,
    basePubKey: key
  })

  let sealed
  const stubSeal = sandbox.stub(blockchain, 'seal')
    .callsFake(async (sealInfo) => {
      t.same(sealInfo.addresses, [address])
      sealed = true
      return { txId }
    })

  const stubBalance = sandbox.stub(seals.blockchain, 'balance').resolves('aabbccddeeff')

  const stubGetTxs = sandbox.stub(blockchain, 'getTxsForAddresses')
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

  const stubObjectsGet = sandbox.stub(tradle.objects, 'get')
    .callsFake(async (_link) => {
      if (_link === link) {
        return sealedObj
      }

      throw new Error('NotFound')
    })

  const stubObjectsPut = sandbox.stub(tradle.objects, 'put')
    .callsFake(async (object) => {
      t.equal(object._seal.link, link)
      t.equal(object._seal.txId, txId)
    })

  const stubDBUpdate = sandbox.stub(tradle.db, 'update')
    .callsFake(async (props) => {
      t.equal(props[TYPE], sealedObj[TYPE])
      t.equal(props._permalink, permalink)
      t.equal(props._seal.link, link)
      t.equal(props._seal.txId, txId)
    })

  const stubDBGet = sandbox.stub(tradle.db, 'get')
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

  clock.tick(2)
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

  sandbox.restore()
  clock.restore()
  t.end()
}))

test('corda seals', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const table = await recreateTable(SealsTableLogicalId)
  const env = new Env(process.env)
  const blockchainOpts = env.BLOCKCHAIN = {
    flavor: 'corda',
    networkName: 'private'
  }

  const { seals, objects, db } = new Tradle(env)
  const endpoint = {
    apiKey: 'myApiKey',
    apiUrl: 'http://localhost:12345'
  }

  // @ts-ignore
  seals.setEndpoint(endpoint)

  const txId = 'sometxid'
  const link = 'abc'
  nock(endpoint.apiUrl)
    .post(uri => uri.startsWith('/item'))
    .reply(function (url, body) {
      body = QS.parse(body)
      t.same(body, {
        link: sealOpts.link,
        partyTmpId: sealOpts.counterparty
      })

      return { txId }
    })

  const sealOpts = {
    link,
    counterparty: aliceIdentity._link
  }

  const obj = {
    [TYPE]: 'tradle.SimpleMessage',
    [SIG]: 'somesig',
    message: 'some message',
    _link: link,
    _permalink: link
  }

  sandbox.stub(objects, 'get').callsFake(async (link) => {
    if (link === 'abc') {
      return obj
    }

    throw new Errors.NotFound(link)
  })

  sandbox.stub(db, 'get').callsFake(async (opts) => {
    if (opts._permalink === obj._permalink) {
      return obj
    }

    throw new Errors.NotFound(link)
  })

  const expectedSealResource = {
    [TYPE]: 'tradle.Seal',
    txId,
    blockchain: blockchainOpts.flavor,
    network: blockchainOpts.networkName,
    ...sealOpts,
  }

  const fakePut = async (obj) => {
    t.same(_.pick(obj._seal, Object.keys(expectedSealResource)), expectedSealResource)
  }

  sandbox.stub(db, 'put').callsFake(fakePut)
  sandbox.stub(objects, 'put').callsFake(fakePut)

  await seals.create(sealOpts)
  const result = await seals.sealPending()
  t.same(result.map(r => _.pick(r, ['txId', 'link'])), [{ txId, link: sealOpts.link }])

  t.same(await seals.getUnconfirmed(), [])
  t.same(await seals.getLongUnconfirmed(), [])
  t.same(await seals.getUnsealed(), [])
  t.same(await seals.getFailedReads(), [])
  t.same(await seals.getFailedWrites(), [])

  const saved = await seals.get(sealOpts)
  const expected = {
    errors: [],
    counterparty: 'dcd023c77d5894699a317381696be028ae11a715d5f9ad78b92b2168dd226711',
    network: env.BLOCKCHAIN.networkName,
    blockchain: env.BLOCKCHAIN.flavor,
    txId,
    write: true,
    confirmations: 0,
    link: 'abc',
  }

  t.same(_.pick(saved, Object.keys(expected)), expected)
  sandbox.restore()
  t.end()
}))
