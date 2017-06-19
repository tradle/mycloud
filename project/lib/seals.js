const debug = require('debug')('tradle:sls:seals')
const { utils, protocol } = require('@tradle/engine')
// const Blockchain = require('./blockchain')
const { SealsTable } = require('./tables')
const { getUpdateParams } = require('./db-utils')
const { extend, pick, timestamp, typeforce } = require('./utils')
const types = require('./types')
const Errors = require('./errors')
const MAX_ERRORS_RECORDED = 10
const CONFIRMATIONS_BEFORE_CONFIRMED = 10
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

module.exports = function manageSeals ({ blockchain, table }) {
  typeforce(blockchain, types.blockchain)

  const getPending = co(function* (limit=Infinity) {
    const KeyConditionExpression = [
      'time > :time',
      'confirmations = :confirmations',
    ].join(' AND ')

    const query = {
      KeyConditionExpression,
      ExpressionAttributeValues: {
        ':time': 0,
        ':confirmations': -1
      }
    }

    if (limit !== Infinity) {
      query.Limit = limit
    }

    return table.find(query)
  })

  // not incredibly efficient
  const getPendingWrites = co(function* (limit) {
    const pending = yield getPending(limit)
    return pending.filter(seal => seal.write)
  })

  const sealPending = co(function* (opts={}) {
    typeforce({
      limit: typeforce.maybe(typeforce.Number)
    }, opts)

    const { limit=Infinity } = opts
    const pending = yield getPendingWrites(limit)
    for (let sealInfo of pending) {
      let result
      try {
        result = yield blockchain.seal(sealInfo)
      } catch (error) {
        yield recordWriteError({ blockchaim, seal: sealInfo, error })
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
      yield SealsTable.put({
        Item: seal,
        ConditionExpression: 'attribute_not_exists(link)',
      })
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        const dErr = new Errors.Duplicate()
        dErr.link = link
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

    const linkBuf = utils.linkToBuf(link)
    const basePubKey = utils.toECKeyObj(key)
    let pubKey
    if (watchType === WATCH_TYPE.this) {
      pubKey = protocol.sealPubKey({ link: linkBuf, basePubKey })
    } else {
      pubKey = protocol.sealPrevPubKey({ prevLink: linkBuf, basePubKey })
    }

    const address = Blockchain.network.pubKeyToAddress(pubKey)
    return {
      blockchain: blockchain.type,
      network: blockchain.name,
      link,
      address,
      pubKey,
      watchType,
      write: true,
      time: timestamp(),
      confirmations: -1,
      errors: []
    }
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
    const props = {
      txId: result.txId,
      confirmations: result.confirmations || 0
      timeSealed: timestamp()
    }

    const params = getUpdateParams(props)
    params.Key = getKey(seal)
    return SealsTable.update(params)
  }

  const recordWriteError = function recordWriteError ({ seal, error }) {
    debug(`failed to seal ${seal.link}`, error.stack)
    const errors = addError(seal.errors, error)
    const params = getUpdateParams({ errors })
    params.Key = getKey(seal)
    return SealsTable.update(params)
  }

  const getUnconfirmed = function getUnconfirmed () {
    const query = {
      // probably inefficient
      KeyConditionExpression: 'time > :time AND confirmations < :confirmations',
      ExpressionAttributeValues: {
        ':time': 0,
        ':confirmations': CONFIRMATIONS_BEFORE_CONFIRMED
      }
    }

    return SealsTable.find(query)
  }

  const syncUnconfirmed = co(function* () {
    const unconfirmed = yield getUnconfirmed()
    const addresses = unconfirmed.map(({ address }) => address)
    const txInfos = yield getTransactionsForAddresses(addresses)
    const updates = unconfirmed.map((sealInfo, i) => {
      const txInfo = txInfos[i]
      if (sealInfo.confirmations === txInfo.confirmations) return

      const update = getUpdateParams({
        address: sealInfo.address,
        confirmations: txInfos.confirmations
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
    yield updates.map(SealsTable.update)
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
    return pick(sealInfo, ['time', 'confirmations'])
  }

  return {
    getPending,
    sealPending,
    // export for testing
    recordWriteError,
    recordWriteSuccess,
    syncUnconfirmed,
    create: createSeal,
    watch,
    watchNextVersion
  }
}
