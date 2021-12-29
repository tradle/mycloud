const nock = require('nock')

require('./env').install()

// const AWS = require('aws-sdk')
import QS from 'querystring'
import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
import { TYPE } from '@tradle/constants'
import protocol from '@tradle/protocol'
import { addLinks } from '../crypto'
import { createTestBot } from '../'
import { Env } from '../env'
import Errors from '../errors'
import { loudAsync, wait } from '../utils'
import { recreateDB } from './utils'
import { getLocalIp } from '@tradle/aws-common-utils'
const aliceKeys = require('./fixtures/alice/keys')
const bobKeys = require('./fixtures/bob/keys')
const aliceIdentity = require('./fixtures/alice/identity')
const bobIdentity = require('./fixtures/bob/identity')
addLinks(aliceIdentity)
addLinks(bobIdentity)
const blockchainOpts = {
  blockchain: 'ethereum',
  networkName: 'rinkeby'
}

const env = new Env(process.env)
env.BLOCKCHAIN = blockchainOpts

const createBot = () => createTestBot({ env })

const rejectEtherscanCalls = () => {
  nock('http://rinkeby.etherscan.io/')
    .get(uri => uri.startsWith('/api'))
    .reply(() => {
      rejectEtherscanCalls()
      return {
        statusCode: 403,
        body: '403 - Forbidden: Access is denied.'
      }
    })
}

rejectEtherscanCalls()

test(
  'handle failed reads/writes',
  loudAsync(async t => {
    const sandbox = sinon.createSandbox()
    const flavor = blockchainOpts.blockchain
    const { networkName } = blockchainOpts
    const bot = createBot()
    const txId = 'sometxid'

    const { blockchain, seals, db } = bot
    const aliceKey = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
    const bobKey = bobKeys.find(key => key.type === flavor && key.networkName === networkName)
    const stubGetTxs = sandbox.stub(blockchain, 'getTxsForAddresses').resolves([])

    await recreateDB(db)

    // clean up
    // await Promise.all([aliceIdentity._link, bobIdentity._link].map(link => db.del({
    //   [TYPE]: 'tradle.SealState',
    //   link
    // })))

    await seals.create({ key: aliceKey, object: aliceIdentity })
    await seals.watch({ key: bobKey, object: bobIdentity })

    const unconfirmed = await seals.getUnconfirmed()
    t.equal(unconfirmed.length, 1)

    const failedReads = await seals.getFailedReads({ gracePeriod: 1 }) // 1ms
    t.equal(failedReads.length, 1)

    const stubSeal = sandbox.stub(seals.blockchain, 'seal').resolves({ txId: 'sometxid' })
    const stubBalance = sandbox.stub(seals.blockchain, 'balance').resolves('aabbccddeeff')
    await seals.sealPending()
    const failedWrites = await seals.getFailedWrites({ gracePeriod: 1 }) // 1ms
    t.equal(failedWrites.length, 1)

    const longUnconfirmed = await seals.getLongUnconfirmed({ gracePeriod: 1 }) // 1ms
    t.equal(longUnconfirmed.length, 2)

    const spyBatchPut = sinon.spy(db, 'batchPut')
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

    const unsealed = await seals.getUnsealed()
    t.equal(unsealed.length, 1)

    t.equal(stubSeal.callCount, 1)
    await seals.sealPending()

    t.equal(stubSeal.callCount, 2)
    sandbox.restore()
    t.end()
  })
)

test(
  'queue seal',
  loudAsync(async t => {
    const sandbox = sinon.createSandbox()
    const bot = createBot()
    const { db, identity } = bot

    await recreateDB(db)

    const { networkName } = blockchainOpts
    const flavor = blockchainOpts.blockchain
    const sealedObj: any = await identity.sign({
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message: 'hey ho'
      }
    })

    const link = sealedObj._link
    const permalink = sealedObj._permalink
    const txId = 'sometxid'
    // const blockchain = createBlockchainAPI({ blockchain, networkName })
    const { blockchain, seals } = bot
    const key = aliceKeys.find(key => key.type === flavor && key.networkName === networkName)
    const address = blockchain.sealAddress({
      headerHash: protocol.headerHash(sealedObj),
      basePubKey: key
    })

    let sealed
    const stubSeal = sandbox.stub(blockchain, 'seal').callsFake(async sealInfo => {
      t.same(sealInfo.address, address)
      sealed = true
      return { txId }
    })

    const stubBalance = sandbox.stub(seals.blockchain, 'balance').resolves('aabbccddeeff')

    const txResults = [
      {
        txId,
        confirmations: 10000,
        to: {
          addresses: [address]
        }
      }
    ]

    const stubGetTxs = sandbox.stub(blockchain, 'getTxsForAddresses').resolves(txResults)
    const stubObjectsGet = sandbox.stub(bot.objects, 'get').callsFake(async _link => {
      if (_link === link) {
        return sealedObj
      }

      throw new Error('NotFound')
    })

    const stubObjectsPut = sandbox.stub(bot.objects, 'put').callsFake(async object => {
      t.equal(object._seal.link, link)
      t.equal(object._seal.txId, txId)
    })

    // const spyDBUpdate = sandbox.stub(bot.db, 'update')
    //   .callsFake(async (props) => {
    //     if (props[TYPE] !== 'tradle.SealState') {
    //       t.equal(props[TYPE], sealedObj[TYPE])
    //       t.equal(props._permalink, permalink)
    //       t.equal(props._seal.link, link)
    //       t.equal(props._seal.txId, txId)
    //     }
    //   })

    const { get } = db
    const stubDBGet = sandbox.stub(db, 'get').callsFake(async props => {
      if (props._permalink === permalink) {
        return sealedObj
      }

      return get.call(db, props)
      // throw new Errors.NotFound(permalink)
    })

    // const clock = sinon.useFakeTimers()
    await seals.create({ key, object: sealedObj })
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

    // clock.tick(2)
    let longUnconfirmed = await seals.getLongUnconfirmed({ gracePeriod: 1 }) // 1ms
    t.equal(longUnconfirmed.length, 1)

    longUnconfirmed = await seals.getLongUnconfirmed({ gracePeriod: 10000 }) // 1s
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

    sandbox.restore()
    // clock.restore()
    t.end()
  })
)

test(
  'corda seals',
  loudAsync(async t => {
    const sandbox = sinon.createSandbox()
    const env = new Env(process.env)
    const blockchainOpts = (env.BLOCKCHAIN = {
      blockchain: 'corda',
      networkName: 'private'
    })

    const { seals, objects, db, identity } = createTestBot({ env })

    await recreateDB(db)

    const endpoint = {
      apiKey: 'myApiKey',
      apiUrl: `http://${getLocalIp()}:12345`
    }

    // @ts-ignore
    seals.setEndpoint(endpoint)

    const txId = 'sometxid'
    nock(endpoint.apiUrl)
      .post(uri => uri.startsWith('/item'))
      .reply(function(url, body) {
        body = QS.parse(body)
        t.deepEqual({...body}, {
          link: sealOpts.link,
          partyTmpId: sealOpts.counterparty
        })

        return { txId }
      })

    const obj = await identity.sign({
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message: 'some message'
      }
    })

    const link = obj._link
    const permalink = obj._permalink
    const sealOpts = {
      headerHash: protocol.headerHash(obj),
      link,
      permalink,
      counterparty: aliceIdentity._link
    }

    sandbox.stub(objects, 'get').callsFake(async link => {
      if (link === obj._link) {
        return obj
      }

      throw new Errors.NotFound(link)
    })

    const { get } = db
    sandbox.stub(db, 'get').callsFake(async opts => {
      if (opts._permalink === obj._permalink) {
        return obj
      }

      return get.call(db, opts)
      // throw new Errors.NotFound(link)
    })

    const expectedSealResource = {
      [TYPE]: 'tradle.Seal',
      txId,
      blockchain: blockchainOpts.blockchain,
      network: blockchainOpts.networkName,
      ...sealOpts
    }

    const fakePut = async obj => {
      t.same(_.pick(obj._seal, Object.keys(expectedSealResource)), expectedSealResource)
    }

    const spyDB = sandbox.spy(db, 'put') // .callsFake(fakePut)
    const stubObjects = sandbox.stub(objects, 'put').callsFake(fakePut)

    await seals.create(sealOpts)

    t.equal(spyDB.callCount, 1)
    t.equal(stubObjects.callCount, 0)

    const result = await seals.sealPending()

    t.same(result.seals.map(r => _.pick(r, ['txId', 'link'])), [{ txId, link: sealOpts.link }])
    t.same(await seals.getUnconfirmed(), [])
    t.same(await seals.getLongUnconfirmed(), [])
    t.same(await seals.getUnsealed(), [])
    t.same(await seals.getFailedReads(), [])
    t.same(await seals.getFailedWrites(), [])

    const saved = await seals.get(sealOpts)
    const expected = {
      counterparty: sealOpts.counterparty,
      network: env.BLOCKCHAIN.networkName,
      blockchain: env.BLOCKCHAIN.blockchain,
      txId,
      write: true,
      confirmations: 0,
      link
    }

    t.same(_.pick(saved, Object.keys(expected)), expected)
    sandbox.restore()
    t.end()
  })
)

// test.only('detect next version', loudAsync(async (t) => {
//   const sandbox = sinon.createSandbox()
//   const bot = createBot()
//   const { seals, db, objects } = bot
//   sandbox.stub(seals.blockchain, 'balance').resolves('aabbccddeeff')
//   sandbox.stub(db, 'put').resolves()
//   sandbox.stub(objects, 'put').resolves()

//   const v0 = await bot.signAndSave({
//     [TYPE]: 'tradle.SimpleMessage',
//     message: 'hey'
//   })

//   const seal = await seals.create({ object: v0 })
//   const watch = seals.watchNextVersion({ object: v0 })
//   const { address } = watch

//   const v1 = await bot.createNewVersion(v0)
//   seals.create({ object: v1 })

//   const txResults = [
//     {
//       txId,
//       confirmations: 10000,
//       to: {
//         addresses: [address]
//       }
//     }
//   ]

//   const stubGetTxs = sandbox.stub(blockchain, 'getTxsForAddresses').resolves(txResults)

//   sandbox.restore()
//   t.end()
// }))
