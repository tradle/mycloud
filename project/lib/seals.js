const debug = require('debug')('tradle:sls:seals')
const { utils, protocol } = require('@tradle/engine')
// const Blockchain = require('./blockchain')
const { getUpdateParams } = require('./db-utils')
const { co, extend, pick, timestamp, typeforce, uuid } = require('./utils')
const types = require('./types')
const Errors = require('./errors')
const MAX_ERRORS_RECORDED = 10
const { SEAL_CONFIRMATIONS } = require('./env')
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

function manageSeals ({ blockchain, table }) {
  typeforce(types.blockchain, blockchain)

  const confirmationsRequired = SEAL_CONFIRMATIONS[blockchain.toString()]
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
      limit: typeforce.maybe(typeforce.Number)
    }, opts)

    const { limit=Infinity } = opts
    const pending = yield getUnsealed({ limit })
    for (let sealInfo of pending) {
      let result
      try {
        result = yield blockchain.seal(sealInfo)
      } catch (error) {
        yield recordWriteError({ seal: sealInfo, error })
        return
      }

      yield recordWriteSuccess({
        blockchain,
        seal: sealInfo,
        result
      })
    }
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
      unconfirmed: 'y'
    }

    if (write) {
      params.unsealed = 'y'
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

  const recordWriteSuccess = function recordWriteSuccess ({ seal, result }) {
    typeforce({
      txId: typeforce.String,
      confirmations: typeforce.maybe(typeforce.Number)
    }, result)

    const props = {
      txId: result.txId,
      confirmations: result.confirmations || 0,
      timeSealed: timestamp(),
      unsealed: null
    }

    const params = getUpdateParams(props)
    params.Key = getKey(seal)
    return table.update(params)
  }

  const recordWriteError = function recordWriteError ({ seal, error }) {
    debug(`failed to seal ${seal.link}`, error.stack)
    const errors = addError(seal.errors, error)
    const params = getUpdateParams({ errors })
    params.Key = getKey(seal)
    return table.update(params)
  }

  const syncUnconfirmed = co(function* () {
    const unconfirmed = yield getUnconfirmed()
    const addresses = unconfirmed.map(({ address }) => address)
    const txInfos = yield blockchain.getTransactionsForAddresses(addresses)
    const updates = unconfirmed.map((sealInfo, i) => {
      const txInfo = txInfos[i]
      if (sealInfo.confirmations === txInfo.confirmations) return

      const { confirmations=0 } = txInfo
      const update = getUpdateParams({
        address: sealInfo.address,
        confirmations,
        unconfirmed: confirmations < confirmationsRequired ? 'x' : null
      })

      update.Key = getKey(sealInfo)
      return update
    })
    .filter(update => update)

    if (!updates.length) {
      debug(`blockchain has nothing new for ${addresses.length} synced addresses`)
      return
    }

    // TODO: use dynamodb-wrapper
    // make this more robust
    yield updates.map(table.update)
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

  return {
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

// module.exports = manageSeals({
//   blockchain: require('./blockchain'),
//   table: require('./tables').SealsTable
// })
