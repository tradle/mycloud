const debug = require('debug')('tradle:sls:bot-engine')
const types = require('./types')
const { co, omit, typeforce, isPromise } = require('./utils')
const { getRecordsFromEvent } = require('./db-utils')
const wrap = require('./wrap')
const Messages = require('./messages')
const Provider = require('./provider')
const Errors = require('./errors')
const constants = require('./constants')
const { getChainKey } = require('./crypto')
const _tradle = require('./tradle')
const waterfall = {
  onmessage: true
}

module.exports = createBotEngine

function createBotEngine (tradle=_tradle) {
  const { seals, network } = tradle
  const chainKeyProps = {
    type: network.flavor,
    networkName: network.networkName
  }

  const getMyChainKey = co(function* () {
    const keys = yield Provider.getMyKeys()
    return getChainKey(keys, chainKeyProps)
  })

  const createSeal = co(function* ({ link }) {
    const chainKey = yield getMyChainKey()
    yield seals.create({
      link,
      key: chainKey
    })
  })

  const execMiddleware = co(function* (method, event) {
    const fns = middleware[method]
    for (let fn of fns) {
      let result = fn(event)
      if (isPromise(result)) result = yield result
      if (waterfall[method]) event = result
    }
  })

  function addMiddleware (method, fn) {
    middleware[method].push(fn)
    return event => execMiddleware(method, event)
  }

  function sendMessage (opts) {
    try {
      typeforce({
        to: typeforce.String,
        object: typeforce.oneOf(types.unsignedObject, types.signedObject),
        other: typeforce.maybe(typeforce.Object)
      }, opts)
    } catch (err) {
      throw new Errors.InvalidInput('invalid params to send()')
    }

    const { to } = opts
    opts = omit(opts, 'to')
    opts.recipient = to
    return Provider.sendMessage(opts)
  }

  const middleware = {}
  const api = {
    send: sendMessage,
    seal: createSeal,
    constants
  }

  ;['onreadseal', 'onwroteseal', 'onmessage'].forEach(method => {
    middleware[method] = []
    api[method] = fn => addMiddleware(method, fn)
  })

  addMiddleware('onmessage', co(function* (event) {
    const { author, time } = JSON.parse(event)
    return yield Messages.getMessageFrom({ author, time })
  }))

  api._onsealevent = co(function* (event) {
    const records = getRecordsFromEvent(event, true)
    for (let record of records) {
      let method
      if (record.old.unsealed && !record.new.unsealed) {
        method = 'onwroteseal'
      } else {
        // do we care about distinguishing between # of confirmations
        // in terms of the event type?
        method = 'onreadseal'
      }

      yield execMiddleware(method, record.new)
    }
  })

  return api
}
