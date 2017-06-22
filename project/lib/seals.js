const debug = require('debug')('tradle:sls:seals')
const { utils, protocol } = require('@tradle/engine')
// const Blockchain = require('./blockchain')
const { getUpdateParams } = require('./db-utils')
const { co, clone, extend, pick, timestamp, typeforce, uuid, isPromise } = require('./utils')
const { prettify } = require('./string-utils')
const types = require('./types')
const Errors = require('./errors')
const Provider = require('./provider')
const MAX_ERRORS_RECORDED = 10
// const { SEAL_CONFIRMATIONS } = require('./env')
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

const YES = 'y'
const noop = () => {}

function manageSeals ({ blockchain, table, confirmationsRequired }) {
  typeforce(types.blockchain, blockchain)

  // const confirmationsRequired = SEAL_CONFIRMATIONS[blockchain.toString()]
  const scanner = IndexName => co(function* (opts={}) {
    const { limit=Infinity } = opts
    const query = { IndexName }
    if (limit !== Infinity) {
      query.Limit = limit
    }

    return table.scan(query)
  })

  const getUnconfirmed = scanner('unconfirmed')
  const getUnsealed = scanner('unsealed')
  const sealPending = co(function* (opts={}) {
    typeforce({
      limit: typeforce.maybe(typeforce.Number),
      key: typeforce.maybe(types.privateKey)
    }, opts)

    let { limit=Infinity, key } = opts
    if (!key) {
      key = yield Provider.getMyChainKey()
    }

    const pending = yield getUnsealed({ limit })
    yield pending.map(co(function* (sealInfo) {
      const { link, address } = sealInfo
      const addresses = [address]
      let result
      try {
        result = yield blockchain.seal({ addresses, link, key })
      } catch (error) {
        yield recordWriteError({ seal: sealInfo, error })
        return
      }

      yield recordWriteSuccess({
        seal: sealInfo,
        txId: result.txId
      })
    }))
  })

  const createSealRecord = co(function* (opts) {
    const seal = getNewSealParams(opts)
    try {
      yield table.put({
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

  const getNewSealParams = function getNewSealParams ({
    key,
    link,
    watchType=WATCH_TYPE.this,
    write=true
  }) {
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

  const watch = function watch ({ key, link }) {
    return createSealRecord({ key, link, write: false })
  }

  const watchNextVersion = function watchNextVersion ({ key, link }) {
    const type = WATCH_TYPE.next
    return createSealRecord({ key, link, type, write: false })
  }

  const createSeal = co(function* ({ key, link }) {
    return createSealRecord({ key, link, write: true })
  })

  const recordWriteSuccess = co(function* ({ seal, txId }) {
    typeforce(typeforce.String, txId)
    debug(`sealed ${seal.link} with tx ${txId}`)

    const update = {
      txId,
      confirmations: 0,
      timeSealed: timestamp(),
      unsealed: null
    }

    const params = getUpdateParams(update)
    params.Key = getKey(seal)
    yield table.update(params)
    return clone(seal, update)
  })

  const recordWriteError = function recordWriteError ({ seal, error }) {
    debug(`failed to seal ${seal.link}`, error.stack)
    const errors = addError(seal.errors, error)
    const params = getUpdateParams({ errors })
    params.Key = getKey(seal)
    return table.update(params)
  }

  const syncUnconfirmed = co(function* () {
    const unconfirmed = yield getUnconfirmed()
    if (!unconfirmed.length) return

    const addresses = unconfirmed.map(({ address }) => address)
    const txInfos = yield blockchain.getTransactionsForAddresses(addresses)
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
          unconfirmed: confirmations < confirmationsRequired ? YES : null
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
      const params = getUpdateParams(update)
      params.Key = getKey(seal)
      yield table.update(params)
    }))

    // TODO: use dynamodb-wrapper
    // make this more robust
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

  const getSeal = co(function* ({ link }) {
    const { id } = yield table.findOne({
      IndexName: 'link',
      KeyConditionExpression: 'link = :link',
      ExpressionAttributeValues: {
        ':link': link
      }
    })

    return table.get({
      Key: { id }
    })
  })

  return {
    get: getSeal,
    getUnconfirmed,
    getUnsealed,
    sealPending,
    syncUnconfirmed,
    create: createSeal,
    watch,
    watchNextVersion,
    // export for testing
    recordWriteError,
    recordWriteSuccess,
  }
}

module.exports = manageSeals
