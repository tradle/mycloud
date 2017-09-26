const debug = require('debug')('tradle:sls:seals')
const { utils, protocol } = require('@tradle/engine')
// const Blockchain = require('./blockchain')
const {
  co,
  clone,
  extend,
  pick,
  timestamp,
  typeforce,
  uuid,
  isPromise,
  seriesMap,
  bindAll
} = require('./utils')
const { prettify } = require('./string-utils')
const dbUtils = require('./db-utils')
const types = require('./typeforce-types')
const Errors = require('./errors')
const MAX_ERRORS_RECORDED = 10
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

const YES = 'y'
const noop = () => {}
const notNull = val => !!val

module.exports = Seals

function Seals ({
  provider,
  blockchain,
  tables,
  network
}) {
  typeforce(types.blockchain, blockchain)
  bindAll(this)

  this.provider = provider
  this.blockchain = blockchain
  this.table = tables.Seals
  this.network = network
  const scanner = IndexName => co(function* (opts={}) {
    const { limit=Infinity } = opts
    const query = { IndexName }
    if (limit !== Infinity) {
      query.Limit = limit
    }

    return this.table.scan(query)
  }).bind(this)

  this.getUnconfirmed = scanner('unconfirmed')
  this.getUnsealed = scanner('unsealed')
  this.sealPending = blockchain.wrapOperation(this._sealPending)
  this.syncUnconfirmed = blockchain.wrapOperation(this._syncUnconfirmed)
}

const proto = Seals.prototype

proto._sealPending = co(function* (opts={}) {
  typeforce({
    limit: typeforce.maybe(typeforce.Number),
    key: typeforce.maybe(types.privateKey)
  }, opts)

  const {
    blockchain,
    provider,
    getUnsealed,
    recordWriteSuccess,
    recordWriteError
  } = this


  let { limit=Infinity, key } = opts
  if (!key) {
    key = yield provider.getMyChainKey()
  }

  const pending = yield getUnsealed({ limit })
  debug(`found ${pending.length} pending seals`)
  let aborted
  const results = yield seriesMap(pending, co(function* (sealInfo) {
    if (aborted) return

    const { link, address } = sealInfo
    const addresses = [address]
    let result
    try {
      result = yield blockchain.seal({ addresses, link, key })
    } catch (error) {
      if (/insufficient/i.test(error.message)) {
        debug(`aborting, insufficient funds, send funds to ${key.fingerprint}`)
        aborted = true
      }

      yield recordWriteError({ seal: sealInfo, error })
      return
    }

    const { txId } = result
    yield recordWriteSuccess({
      seal: sealInfo,
      txId
    })

    return { txId, link }
  }))

  return results.filter(notNull)
})

proto.createSealRecord = co(function* (opts) {
  const seal = this.getNewSealParams(opts)
  try {
    yield this.table.put({
      Item: seal,
      ConditionExpression: 'attribute_not_exists(link)',
    })
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      const dErr = new Errors.Duplicate()
      dErr.link = seal.link
      throw dErr
    }

    throw err
  }
})

proto.getNewSealParams = function getNewSealParams ({
  key,
  link,
  watchType=WATCH_TYPE.this,
  write=true
}) {
  const { blockchain } = this

  // the next version's previous is the current version
  // the tx for next version will have a predictable seal based on the current version's link
  // address: utils.sealPrevAddress({ network, basePubKey, link }),

  let pubKey
  if (watchType === WATCH_TYPE.this) {
    pubKey = blockchain.sealPubKey({ link, basePubKey: key })
  } else {
    pubKey = blockchain.sealPrevPubKey({ prevLink: link, basePubKey: key })
  }

  const address = blockchain.pubKeyToAddress(pubKey.pub)
  const params = {
    id: uuid(),
    blockchain: blockchain.toString(),
    link,
    address,
    pubKey,
    watchType,
    write: true,
    time: timestamp(),
    confirmations: -1,
    errors: [],
    unconfirmed: YES
  }

  if (write) {
    params.unsealed = YES
  }

  return params
}

proto.watch = function watch ({ key, link }) {
  return this.createSealRecord({ key, link, write: false })
}

proto.watchNextVersion = function watchNextVersion ({ key, link }) {
  const type = WATCH_TYPE.next
  return this.createSealRecord({ key, link, type, write: false })
}

proto.create = co(function* ({ key, link }) {
  return this.createSealRecord({ key, link, write: true })
})

proto.recordWriteSuccess = co(function* ({ seal, txId }) {
  typeforce(typeforce.String, txId)
  debug(`sealed ${seal.link} with tx ${txId}`)

  const update = {
    txId,
    confirmations: 0,
    timeSealed: timestamp(),
    unsealed: null
  }

  const params = dbUtils.getUpdateParams(update)
  params.Key = getKey(seal)
  yield this.table.update(params)
  return clone(seal, update)
})

proto.recordWriteError = function recordWriteError ({ seal, error }) {
  debug(`failed to seal ${seal.link}`, error.stack)
  const errors = addError(seal.errors, error)
  const params = dbUtils.getUpdateParams({ errors })
  params.Key = getKey(seal)
  return this.table.update(params)
}

proto._syncUnconfirmed = co(function* () {
  const { blockchain, getUnconfirmed, network, table } = this
  // start making whatever connections
  // are necessary
  blockchain.start()

  const unconfirmed = yield getUnconfirmed()
  if (!unconfirmed.length) return

  const addresses = unconfirmed.map(({ address }) => address)
  const txInfos = yield blockchain.getTxsForAddresses(addresses)
  if (!txInfos.length) return

  const addrToSeal = {}
  addresses.forEach((address, i) => {
    addrToSeal[address] = unconfirmed[i]
  })

  const updates = {}
  for (let txInfo of txInfos) {
    let { txId } = txInfo
    let to = txInfo.to.addresses
    for (let address of to) {
      if (!addrToSeal[address]) continue

      let seal = addrToSeal[address]
      let { confirmations=0 } = txInfo
      if (seal.confirmations >= confirmations) continue

      updates[address] = {
        txId,
        confirmations,
        unconfirmed: confirmations < network.confirmations ? YES : null
      }
    }
  }

  if (!Object.keys(updates).length) {
    debug(`blockchain has nothing new for ${addresses.length} synced addresses`)
    return
  }

  yield Object.keys(updates).map(co(function* (address, i) {
    const update = updates[address]
    const seal = addrToSeal[address]
    const params = dbUtils.getUpdateParams(update)
    params.Key = getKey(seal)
    yield table.update(params)
  }))

  // TODO: use dynamodb-wrapper
  // make this more robust
})

proto.get = co(function* ({ link }) {
  const { id } = yield this.table.findOne({
    IndexName: 'link',
    KeyConditionExpression: 'link = :link',
    ExpressionAttributeValues: {
      ':link': link
    }
  })

  return this.table.get({
    Key: { id }
  })
})

function addError (errors=[], error) {
  errors = errors.concat({
    time: timestamp(),
    stack: error.stack
  })

  if (errors.length > MAX_ERRORS_RECORDED) {
    errors = errors.slice(errors.length - MAX_ERRORS_RECORDED)
  }

  return errors
}

function getKey (sealInfo) {
  return pick(sealInfo, 'id')
}
