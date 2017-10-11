const co = require('co').wrap
const debug = require('debug')('tradle:sls:bot-engine')
const { getRecordsFromEvent } = require('../db-utils')
const {
  allSettled,
  extend,
  setVirtual
} = require('../utils')

const {
  getMessagePayload
} = require('./utils')

module.exports = function installDefaultHooks ({ bot, hooks }) {
  const savePayloads = co(function* (event) {
    // unmarshalling is prob a waste of time
    const messages = getRecordsFromEvent(event)
    const results = yield allSettled(messages.map(savePayloadToTypeTable))
    logAndThrow(results)
  })

  function logAndThrow (results) {
    const failed = results.map(({ reason }) => reason)
      .filter(reason => reason)

    if (failed.length) {
      debug('failed to save payloads', failed)
      throw failed[0].reason
    }
  }

  // process Inbox & Outbox tables -> type-specific tables
  const savePayloadToTypeTable = co(function* (message) {
    const type = message._payloadType
    const table = bot.db.tables[type]
    if (!table) {
      debug(`not saving "${type}", don't have a model for it`)
      return
    }

    debug(`saving ${type}`)
    const payload = yield getMessagePayload({ bot, message })
    const full = extend(message.object, payload)
    if (!full._time) {
      const _time = message.time || message._time
      if (_time) {
        setVirtual(full, { _time })
      }
    }

    try {
      yield table.put(full)
    } catch (err) {
      // TODO: to DLQ
      debug(`failed to put ${type} ${payload  ._link}, ${err.stack}`)
    }
  })

  bot.hook('seal', co(function* (event) {
    // maybe these should be fanned out to two lambdas
    // instead of handled in the same lambda
    const records = getRecordsFromEvent(event, true)
    for (const record of records) {
      let method
      // when a seal is queued for a write, unsealed is set to 'y'
      // when a seal is written, unsealed is set to null
      const wasJustSealed = (!record.old || record.old.unsealed) && !record.new.unsealed
      if (wasJustSealed) {
        method = 'wroteseal'
      } else {
        // do we care about distinguishing between # of confirmations
        // in terms of the event type?
        method = 'readseal'
      }

      yield hooks.fire(method, record.new)
    }
  }))

  bot.hook('messagestream', savePayloads)
}
