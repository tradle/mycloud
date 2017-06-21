const debug = require('debug')('tradle:sls:bot-engine')
const types = require('./types')
const { co, omit, typeforce, isPromise } = require('./utils')
const { getRecordsFromEvent } = require('./db-utils')
const wrap = require('./wrap')
const Messages = require('./messages')
const Provider = require('./provider')
const Errors = require('./errors')
const { queueSeal } = require('./seals')
const constants = require('./constants')
const ENV = require('./env')
const waterfall = {
  onmessage: true
}

module.exports = createBotEngine

function createBotEngine () {
  const middleware = {}
  const api = {
    send: sendMessage,
    seal: queueSeal,
    constants
  }

  ;['onreadseal', 'onwroteseal', 'onmessage'].forEach(method => {
    middleware[method] = []
    api[method] = fn => addMiddleware(method, fn)
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

  addMiddleware('onmessage', co(function* (event) {
    const { author, time } = JSON.parse(event)
    return yield Messages.getMessageFrom({ author, time })
  }))

  return api
}
